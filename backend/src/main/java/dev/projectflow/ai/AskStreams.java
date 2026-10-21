package dev.projectflow.ai;

import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import dev.projectflow.web.error.ApiException;
import dev.projectflow.web.error.ErrorCode;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.concurrent.DelegatingSecurityContextRunnable;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * Questions answered as a stream of server-sent events, so the person sees Flurry work and can stop
 * it. Events, in order: {@code lookup} (each lookup once it's made: what was read, how it went, the
 * records), {@code delta} (the answer's words as they're written, provisional) and {@code reset}
 * (clear them: the model went on to look things up), then exactly one of {@code answer} (the
 * checked answer, the same as the non-streamed endpoint returns), {@code error} or {@code stopped}.
 * A comment line every 15 seconds keeps proxies from closing a quiet stream and finds out when the
 * person has gone.
 *
 * <p>Stopping: the person who asked can stop the question by its id (the stop button), and a closed
 * connection stops it too. The provider's stream is cancelled at once, so it stops generating; what
 * it used until then still counts against the limits.
 */
@Component
public class AskStreams implements DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(AskStreams.class);
    /** The longest a question can take: five model turns and their lookups, with room to spare. */
    static final long TIMEOUT_MS = 10 * 60 * 1000L;
    static final long HEARTBEAT_SECONDS = 15;
    /** A question's id, chosen by the browser: only for stopping it. */
    static final Pattern ID = Pattern.compile("^[A-Za-z0-9-]{8,64}$");

    private final AiService ai;
    /** Questions being answered, by asker and id, so the asker can stop one. */
    private final Map<String, AtomicBoolean> running = new ConcurrentHashMap<>();
    private final ThreadPoolExecutor workers;
    private final ScheduledExecutorService heartbeats;

    public AskStreams(AiService ai) {
        this.ai = ai;
        AtomicInteger n = new AtomicInteger();
        // Flurry's budget limits how many questions run at once (AI_MAX_CONCURRENT); this is only a ceiling above it.
        this.workers = new ThreadPoolExecutor(0, 64, 60, TimeUnit.SECONDS, new SynchronousQueue<>(), r -> {
            Thread t = new Thread(r, "flurry-answer-" + n.incrementAndGet());
            t.setDaemon(true);
            return t;
        });
        this.heartbeats = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "flurry-heartbeat");
            t.setDaemon(true);
            return t;
        });
    }

    /** On shutdown: every question still running is stopped (its provider stream closed). */
    @Override
    public void destroy() {
        heartbeats.shutdownNow();
        running.values().forEach(s -> s.set(true));
        workers.shutdown();
    }

    private static String key(Long userId, String id) {
        return userId + ":" + id;
    }

    /**
     * Starts answering. Everything that can refuse the question (membership, availability, limits)
     * happens here, before the stream opens, so it's refused with an ordinary error response.
     */
    public SseEmitter start(Long projectId, Requests.AiAsk req, String requestId) {
        String id = requestId != null && ID.matcher(requestId).matches() ? requestId : null;
        AiService.PreparedAsk prepared = ai.prepareAsk(projectId, req);
        AtomicBoolean stopped = new AtomicBoolean(false);
        String key = id == null ? null : key(prepared.userId(), id);
        if (key != null && running.putIfAbsent(key, stopped) != null) {
            ai.release(prepared, null);
            throw new ApiException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, "That question is already being answered.", null);
        }
        SseEmitter emitter = new SseEmitter(TIMEOUT_MS);
        emitter.onTimeout(() -> stopped.set(true));
        emitter.onError(e -> stopped.set(true));
        Runnable work = new DelegatingSecurityContextRunnable(() -> answer(prepared, emitter, stopped, key), SecurityContextHolder.getContext());
        try {
            workers.execute(work);
        } catch (RejectedExecutionException e) {
            if (key != null) running.remove(key);
            ai.release(prepared, "too many questions at once");
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.BUSY,
                    "Flurry is answering as many questions as this server allows right now. Nothing was generated; try again in a few seconds.", null);
        }
        return emitter;
    }

    /** Stops the asker's question with this id, if it's still being answered. Anyone else's id does nothing. */
    public void stop(Long userId, String requestId) {
        if (requestId == null || !ID.matcher(requestId).matches()) return;
        AtomicBoolean s = running.get(key(userId, requestId));
        if (s != null) s.set(true);
    }

    /** Questions being answered as streams right now (for tests and Site health). */
    int open() {
        return running.size();
    }

    private void answer(AiService.PreparedAsk prepared, SseEmitter emitter, AtomicBoolean stopped, String key) {
        ScheduledFuture<?> beat = heartbeats.scheduleAtFixedRate(() -> send(emitter, stopped, SseEmitter.event().comment("working")),
                HEARTBEAT_SECONDS, HEARTBEAT_SECONDS, TimeUnit.SECONDS);
        try {
            Dto.AiAnswer answer = ai.runAsk(prepared, new AiService.AskEvents() {
                @Override
                public void lookup(Dto.AiLookup lookup) {
                    send(emitter, stopped, SseEmitter.event().name("lookup").data(lookup, MediaType.APPLICATION_JSON));
                }

                @Override
                public void delta(String text) {
                    send(emitter, stopped, SseEmitter.event().name("delta").data(Map.of("text", text), MediaType.APPLICATION_JSON));
                }

                @Override
                public void reset() {
                    send(emitter, stopped, SseEmitter.event().name("reset").data(Map.of(), MediaType.APPLICATION_JSON));
                }

                @Override
                public boolean stopped() {
                    return stopped.get();
                }
            });
            if (answer == null) {
                send(emitter, stopped, SseEmitter.event().name("stopped")
                        .data(Map.of("message", "Stopped. Flurry didn’t finish this answer, and nothing was changed."), MediaType.APPLICATION_JSON));
            } else {
                send(emitter, stopped, SseEmitter.event().name("answer").data(answer, MediaType.APPLICATION_JSON));
            }
        } catch (ApiException e) {
            sendError(emitter, stopped, e.status().value(), e.code().name(), e.getMessage());
        } catch (RuntimeException e) {
            log.warn("Flurry's streamed answer failed: {}", e.toString());
            sendError(emitter, stopped, 500, ErrorCode.AI_FAILED.name(), "Something went wrong while answering. Nothing was changed; try again.");
        } finally {
            beat.cancel(false);
            if (key != null) running.remove(key);
            try {
                emitter.complete();
            } catch (RuntimeException ignored) {
                // the connection has gone already
            }
        }
    }

    private void sendError(SseEmitter emitter, AtomicBoolean stopped, int status, String code, String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", status);
        body.put("code", code);
        body.put("message", message);
        send(emitter, stopped, SseEmitter.event().name("error").data(body, MediaType.APPLICATION_JSON));
    }

    /** Sends an event; if the person has gone (the write fails), the question is stopped. */
    private static void send(SseEmitter emitter, AtomicBoolean stopped, SseEmitter.SseEventBuilder event) {
        try {
            emitter.send(event);
        } catch (IOException | IllegalStateException e) {
            stopped.set(true);
        }
    }
}
