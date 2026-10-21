package dev.projectflow.security;

import dev.projectflow.config.LaunchProperties;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Server-side sessions: one row per sign-in, checked on every request. A sign-in token is only as
 * good as its session, so signing out, signing out everywhere, changing or resetting the password,
 * deleting the account and suspension end access at once, not when the token expires.
 *
 * <p>Without "keep me signed in", a session ends after {@code SESSION_IDLE_HOURS} without a
 * request and at most {@code SESSION_MAX_HOURS} after sign-in; with it, after
 * {@code SESSION_REMEMBER_DAYS}. People can see their active sessions and end any of them.
 *
 * <p>A kept sign-in also has a cookie ({@link SessionCookie}): its value is the session's public id
 * and a random secret, and only the secret's SHA-256 is stored here ({@code cookie_hash}). The
 * cookie can get a new sign-in token for its own session while the session is active, nothing else.
 */
@Component
public class SessionStore {

    /** A sign-in. {@code network} is coarse (an IPv4 /24 or IPv6 /48), enough to recognise, not to locate. */
    public record Session(long id, String publicId, long userId, boolean remember, Instant createdAt, Instant lastSeenAt, Instant expiresAt,
                          Instant revokedAt, String revokedReason, String device, String network) {}

    public enum State { ACTIVE, REVOKED, IDLE, EXPIRED }

    /** Last-seen times are written at most this often per session, so busy sessions don't write on every request. */
    static final Duration TOUCH_EVERY = Duration.ofMinutes(2);

    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final LaunchProperties.Sessions policy;
    private final SecureRandom random = new SecureRandom();

    public SessionStore(JdbcTemplate jdbc, Clock clock, LaunchProperties launch) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.policy = (launch == null ? LaunchProperties.defaults() : launch).sessionsOrDefault();
    }

    public LaunchProperties.Sessions policy() {
        return policy;
    }

    /** Opens a session. "Keep me signed in" is honoured only while it's allowed (SESSION_REMEMBER_DAYS above 0). */
    public Session open(long userId, boolean remember, String device, String ip) {
        boolean keep = remember && policy.rememberAllowed();
        Instant now = Instant.now(clock);
        Instant expires = now.plus(keep ? policy.remember() : policy.max());
        byte[] bytes = new byte[16];
        random.nextBytes(bytes);
        String publicId = HexFormat.of().formatHex(bytes);
        String dev = device == null ? null : device.length() > 120 ? device.substring(0, 120) : device;
        String net = network(ip);
        jdbc.update("INSERT INTO user_sessions (public_id, user_id, remember, created_at, last_seen_at, expires_at, device, network) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                publicId, userId, keep, Timestamp.from(now), Timestamp.from(now), Timestamp.from(expires), dev, net);
        return find(publicId).orElseThrow();
    }

    public Optional<Session> find(String publicId) {
        if (publicId == null || !publicId.matches("[0-9a-f]{32}")) return Optional.empty();
        return jdbc.query("SELECT * FROM user_sessions WHERE public_id = ?", (rs, i) -> row(rs), publicId).stream().findFirst();
    }

    public State state(Session s) {
        return state(s, Instant.now(clock), policy.idle());
    }

    /** Whether a session may still be used at {@code now}: not ended, not past its limit, and (unless remembered) not idle too long. */
    static State state(Session s, Instant now, Duration idle) {
        if (s.revokedAt() != null) return State.REVOKED;
        if (!now.isBefore(s.expiresAt())) return State.EXPIRED;
        if (!s.remember() && !now.isBefore(s.lastSeenAt().plus(idle))) return State.IDLE;
        return State.ACTIVE;
    }

    /**
     * For "keep me signed in": a new secret for the session's cookie, replacing any earlier one.
     * Only its SHA-256 is stored. Returns the cookie's value ({@code publicId.secret}), or null
     * when the session isn't a kept one.
     */
    public String newCookie(Session s) {
        if (!s.remember()) return null;
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String secret = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        int updated = jdbc.update("UPDATE user_sessions SET cookie_hash = ? WHERE id = ? AND remember = TRUE AND revoked_at IS NULL", sha256(secret), s.id());
        return updated == 1 ? s.publicId() + "." + secret : null;
    }

    /**
     * The kept sign-in a cookie belongs to, while it can still be used: the secret must match (compared
     * in constant time), and the session must be a kept one, not ended, expired or revoked.
     */
    public Optional<Session> fromCookie(String value) {
        if (value == null || value.length() != 32 + 1 + 43 || value.charAt(32) != '.') return Optional.empty();
        String publicId = value.substring(0, 32);
        String secret = value.substring(33);
        if (!publicId.matches("[0-9a-f]{32}") || !secret.matches("[A-Za-z0-9_-]{43}")) return Optional.empty();
        List<String> stored = jdbc.query("SELECT cookie_hash FROM user_sessions WHERE public_id = ?", (rs, i) -> rs.getString(1), publicId);
        if (stored.isEmpty() || stored.get(0) == null) return Optional.empty();
        byte[] expected = stored.get(0).trim().getBytes(StandardCharsets.US_ASCII);
        if (!MessageDigest.isEqual(expected, sha256(secret).getBytes(StandardCharsets.US_ASCII))) return Optional.empty();
        return find(publicId).filter(s -> s.remember() && state(s) == State.ACTIVE);
    }

    static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Records that the session was used, at most every couple of minutes. */
    public void touch(Session s) {
        Instant now = Instant.now(clock);
        if (s.lastSeenAt().plus(TOUCH_EVERY).isAfter(now)) return;
        jdbc.update("UPDATE user_sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL", Timestamp.from(now), s.id());
    }

    /** Which of these sessions can still be used (for closing live streams whose sign-in ended). */
    public java.util.Set<String> activeAmong(java.util.Collection<String> publicIds) {
        java.util.Set<String> active = new java.util.HashSet<>();
        List<String> ids = publicIds.stream().filter(p -> p != null && p.matches("[0-9a-f]{32}")).distinct().toList();
        Instant now = Instant.now(clock);
        for (int from = 0; from < ids.size(); from += 500) {
            List<String> chunk = ids.subList(from, Math.min(ids.size(), from + 500));
            String marks = String.join(",", java.util.Collections.nCopies(chunk.size(), "?"));
            jdbc.query("SELECT * FROM user_sessions WHERE public_id IN (" + marks + ")", (rs, i) -> row(rs), chunk.toArray()).stream()
                    .filter(s -> state(s, now, policy.idle()) == State.ACTIVE)
                    .forEach(s -> active.add(s.publicId()));
        }
        return active;
    }

    /** The account's sessions that can still be used, most recently used first. */
    public List<Session> active(long userId) {
        Instant now = Instant.now(clock);
        return jdbc.query("SELECT * FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC",
                        (rs, i) -> row(rs), userId, Timestamp.from(now)).stream()
                .filter(s -> state(s, now, policy.idle()) == State.ACTIVE)
                .toList();
    }

    /** Ends one of the account's sessions; false when it isn't theirs or already ended. */
    public boolean revoke(long userId, long sessionId, String reason) {
        return jdbc.update("UPDATE user_sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
                Timestamp.from(Instant.now(clock)), reason, sessionId, userId) > 0;
    }

    public boolean revokeByPublicId(long userId, String publicId, String reason) {
        return jdbc.update("UPDATE user_sessions SET revoked_at = ?, revoked_reason = ? WHERE public_id = ? AND user_id = ? AND revoked_at IS NULL",
                Timestamp.from(Instant.now(clock)), reason, publicId, userId) > 0;
    }

    /** Ends every session of the account, or every one but {@code keepPublicId}. Returns how many ended. */
    public int revokeAll(long userId, String reason, String keepPublicId) {
        Timestamp now = Timestamp.from(Instant.now(clock));
        if (keepPublicId == null) {
            return jdbc.update("UPDATE user_sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL", now, reason, userId);
        }
        return jdbc.update("UPDATE user_sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL AND public_id <> ?",
                now, reason, userId, keepPublicId);
    }

    /** Emergency: signs everyone out (an operator action after a suspected key or token leak). */
    public int revokeEveryone(String reason, Long exceptUserId) {
        Timestamp now = Timestamp.from(Instant.now(clock));
        if (exceptUserId == null) return jdbc.update("UPDATE user_sessions SET revoked_at = ?, revoked_reason = ? WHERE revoked_at IS NULL", now, reason);
        return jdbc.update("UPDATE user_sessions SET revoked_at = ?, revoked_reason = ? WHERE revoked_at IS NULL AND user_id <> ?", now, reason, exceptUserId);
    }

    /** Removes sessions that ended more than 30 days ago. */
    @Scheduled(cron = "0 23 3 * * *")
    public void purge() {
        Timestamp cutoff = Timestamp.from(Instant.now(clock).minus(Duration.ofDays(30)));
        jdbc.update("DELETE FROM user_sessions WHERE expires_at < ? OR revoked_at < ?", cutoff, cutoff);
    }

    /** An IPv4 address as its /24, an IPv6 one as its /48; null when unknown. */
    public static String network(String ip) {
        if (ip == null || ip.isBlank()) return null;
        try {
            byte[] b = InetAddress.getByName(ip.trim()).getAddress();
            if (b.length == 4) return (b[0] & 0xff) + "." + (b[1] & 0xff) + "." + (b[2] & 0xff) + ".0/24";
            return String.format("%x:%x:%x::/48", ((b[0] & 0xff) << 8) | (b[1] & 0xff), ((b[2] & 0xff) << 8) | (b[3] & 0xff), ((b[4] & 0xff) << 8) | (b[5] & 0xff));
        } catch (Exception e) {
            return null;
        }
    }

    private static Session row(ResultSet rs) throws SQLException {
        return new Session(rs.getLong("id"), rs.getString("public_id"), rs.getLong("user_id"), rs.getBoolean("remember"),
                instant(rs, "created_at"), instant(rs, "last_seen_at"), instant(rs, "expires_at"), instant(rs, "revoked_at"),
                rs.getString("revoked_reason"), rs.getString("device"), rs.getString("network"));
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp t = rs.getTimestamp(column);
        return t == null ? null : t.toInstant();
    }
}
