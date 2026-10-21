package dev.projectflow.live;

import dev.projectflow.domain.ProjectMember;
import dev.projectflow.repository.ProjectMemberRepository;
import java.io.IOException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Server-Sent Events for live updates.
 *
 * <p>Browsers can't put a bearer token on an EventSource, so a signed-in client first asks for a
 * one-time ticket (valid {@value #TICKET_SECONDS}s) and opens the stream with it. Events are sent
 * after the transaction commits, only to current members of the project, and contain ids only —
 * the client refetches through the normal endpoints, which apply the usual permission checks.
 *
 * <p>Each stream belongs to the session whose ticket opened it; every heartbeat closes streams whose
 * session ended (signed out, expired or idle), so live updates stop with the sign-in. A person has
 * at most {@value #MAX_STREAMS_PER_USER} open streams (the oldest is closed for a new one), and the
 * server at most {@code LIVE_MAX_STREAMS}.
 */
@Service
public class LiveUpdateService {

    static final int TICKET_SECONDS = 60;
    private static final long STREAM_TIMEOUT_MS = 30 * 60 * 1000L;
    private static final Logger log = LoggerFactory.getLogger(LiveUpdateService.class);

    private record Ticket(Long userId, String sessionId, Instant expires) {}

    static final int MAX_STREAMS_PER_USER = 8;
    private final ProjectMemberRepository members;
    private final Clock clock;
    private final dev.projectflow.security.SessionStore sessions;
    private final int maxStreams;
    private final Map<SseEmitter, String> sessionOf = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Ticket> tickets = new ConcurrentHashMap<>();
    private final Map<Long, List<SseEmitter>> streams = new ConcurrentHashMap<>();
    private final Map<Long, CachedMembers> memberCache = new ConcurrentHashMap<>();
    /** At most this many unused tickets per user; older ones are discarded. */
    private static final int MAX_TICKETS_PER_USER = 5;

    public LiveUpdateService(ProjectMemberRepository members, Clock clock, dev.projectflow.security.SessionStore sessions,
                             @org.springframework.beans.factory.annotation.Value("${LIVE_MAX_STREAMS:5000}") int maxStreams) {
        this.members = members;
        this.clock = clock;
        this.sessions = sessions;
        this.maxStreams = Math.max(1, maxStreams);
    }

    public String issueTicket(Long userId) {
        return issueTicket(userId, null);
    }

    public String issueTicket(Long userId, String sessionId) {
        byte[] bytes = new byte[24];
        random.nextBytes(bytes);
        String ticket = HexFormat.of().formatHex(bytes);
        Instant now = Instant.now(clock);
        // Cap unused tickets per user so a client can't grow this map without limit.
        List<Map.Entry<String, Ticket>> mine = tickets.entrySet().stream()
                .filter(e -> e.getValue().userId().equals(userId))
                .sorted(Comparator.comparing(e -> e.getValue().expires()))
                .toList();
        for (int i = 0; i <= mine.size() - MAX_TICKETS_PER_USER; i++) tickets.remove(mine.get(i).getKey());
        tickets.put(ticket, new Ticket(userId, sessionId, now.plusSeconds(TICKET_SECONDS)));
        return ticket;
    }

    /** Opens a stream for a valid, unused ticket; empty if the ticket is unknown, used or expired. */
    public Optional<SseEmitter> open(String ticket) {
        Ticket t = ticket == null ? null : tickets.remove(ticket);
        if (t == null || t.expires().isBefore(Instant.now(clock))) return Optional.empty();
        if (openStreams() >= maxStreams) {
            log.warn("Live updates: {} streams open, the most this server allows (LIVE_MAX_STREAMS); a new one was refused.", maxStreams);
            throw new dev.projectflow.web.error.ApiException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, dev.projectflow.web.error.ErrorCode.BUSY,
                    "Live updates are busy right now. Your work is saved as usual; the page refreshes its data when you return to it.", null);
        }
        SseEmitter emitter = new SseEmitter(STREAM_TIMEOUT_MS);
        List<SseEmitter> displaced = new ArrayList<>();
        streams.compute(t.userId(), (k, list) -> {
            List<SseEmitter> l = list == null ? new CopyOnWriteArrayList<>() : list;
            while (l.size() >= MAX_STREAMS_PER_USER) displaced.add(l.remove(0));
            l.add(emitter);
            return l;
        });
        displaced.forEach(old -> {
            sessionOf.remove(old);
            try {
                old.complete();
            } catch (RuntimeException ignored) {
                // already closed
            }
        });
        if (t.sessionId() != null) sessionOf.put(emitter, t.sessionId());
        Runnable drop = () -> remove(t.userId(), emitter);
        emitter.onCompletion(drop);
        // Complete on timeout so Spring doesn't raise AsyncRequestTimeoutException; the browser reconnects.
        emitter.onTimeout(() -> {
            drop.run();
            emitter.complete();
        });
        emitter.onError(e -> drop.run());
        send(t.userId(), emitter, "ready", Map.of("at", Instant.now(clock).toString()));
        return Optional.of(emitter);
    }

    /**
     * Ends every live stream and unused ticket of a user, after their password was reset or changed.
     * Devices that still have a valid session reconnect with a new ticket; revoked ones can't.
     */
    public void endSessions(Long userId) {
        tickets.values().removeIf(t -> t.userId().equals(userId));
        List<SseEmitter> open = streams.remove(userId);
        if (open != null) {
            for (SseEmitter e : open) {
                sessionOf.remove(e);
                try {
                    e.complete();
                } catch (RuntimeException ignored) {
                    // already closed
                }
            }
        }
    }

    private void send(Long userId, SseEmitter emitter, String name, Object data) {
        try {
            emitter.send(SseEmitter.event().name(name).data(data));
        } catch (IOException | IllegalStateException e) {
            remove(userId, emitter);
        }
    }

    /** Drops a stream and, when it was the user's last one, the user's entry too. */
    private void remove(Long userId, SseEmitter emitter) {
        sessionOf.remove(emitter);
        streams.computeIfPresent(userId, (id, list) -> {
            list.remove(emitter);
            return list.isEmpty() ? null : list;
        });
    }

    private void sendTo(Long userId, String name, Object data) {
        for (SseEmitter e : streams.getOrDefault(userId, List.of())) send(userId, e, name, data);
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onProjectChanged(LiveEvents.ProjectChanged event) {
        if (openStreams() == 0) return;
        Map<String, Object> data = new HashMap<>();
        data.put("projectId", event.projectId());
        data.put("taskId", event.taskId());
        data.put("actorId", event.actorId());
        data.put("kind", event.kind());
        Set<Long> recipients = new LinkedHashSet<>(memberIds(event.projectId(), event.kind()));
        // Someone who just left, was removed, or lost the project entirely still needs to drop it from their screen.
        if (event.actorId() != null) recipients.add(event.actorId());
        if (event.alsoTo() != null) recipients.addAll(event.alsoTo());
        for (Long userId : recipients) sendTo(userId, "project", data);
    }

    private record CachedMembers(Set<Long> ids, Instant expires) {}

    /**
     * Member ids of a project, cached for a couple of seconds: one request (e.g. applying a plan)
     * can publish many events for the same project, and each would otherwise query the members.
     * Membership changes bypass the cache.
     */
    private Set<Long> memberIds(Long projectId, String kind) {
        Instant now = Instant.now(clock);
        boolean membershipChange = kind != null && (kind.startsWith("MEMBER_") || kind.startsWith("PROJECT_DELETED"));
        CachedMembers cached = memberCache.get(projectId);
        if (!membershipChange && cached != null && cached.expires().isAfter(now)) return cached.ids();
        try {
            Set<Long> ids = new HashSet<>();
            for (ProjectMember m : members.findByProjectId(projectId)) ids.add(m.getUser().getId());
            memberCache.put(projectId, new CachedMembers(ids, now.plusSeconds(2)));
            return ids;
        } catch (RuntimeException e) {
            log.debug("Live update for project {} skipped: {}", projectId, e.getMessage());
            return Set.of();
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onUserNotified(LiveEvents.UserNotified event) {
        sendTo(event.userId(), "notification", Map.of("userId", event.userId()));
    }

    /** Keeps proxies from closing idle streams, closes streams whose sign-in ended, and clears expired tickets. */
    @Scheduled(fixedRate = 25_000)
    public void heartbeat() {
        Instant now = Instant.now(clock);
        tickets.entrySet().removeIf(e -> e.getValue().expires().isBefore(now));
        memberCache.entrySet().removeIf(e -> e.getValue().expires().isBefore(now));
        if (sessions != null && !sessionOf.isEmpty()) {
            try {
                Set<String> active = sessions.activeAmong(new HashSet<>(sessionOf.values()));
                streams.forEach((userId, list) -> {
                    for (SseEmitter e : list) {
                        String sid = sessionOf.get(e);
                        if (sid != null && !active.contains(sid)) {
                            remove(userId, e);
                            try {
                                e.complete();
                            } catch (RuntimeException ignored) {
                                // already closed
                            }
                        }
                    }
                });
            } catch (RuntimeException ex) {
                log.debug("Live updates: couldn't check sessions this time: {}", ex.getMessage());
            }
        }
        streams.forEach((userId, list) -> {
            for (SseEmitter e : list) {
                try {
                    e.send(SseEmitter.event().comment("keep-alive"));
                } catch (IOException | IllegalStateException ex) {
                    remove(userId, e);
                }
            }
        });
    }

    /** For tests and diagnostics. */
    public int openStreams() {
        return streams.values().stream().mapToInt(List::size).sum();
    }
}
