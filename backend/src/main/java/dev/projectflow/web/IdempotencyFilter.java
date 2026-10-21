package dev.projectflow.web;

import dev.projectflow.security.AuthUser;
import dev.projectflow.web.error.ErrorCode;
import dev.projectflow.web.error.ErrorWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletRequestWrapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ContentCachingResponseWrapper;

/**
 * Safe retries. A create or change sent with an {@code Idempotency-Key} header is done once: the
 * same key again (a double click, or the app retrying after a dropped connection) gets the first
 * result back, marked {@code Idempotent-Replayed: true}, instead of creating a second task,
 * comment or submission. While the first is still running, a repeat gets 409; the same key with a
 * different request gets 422. Keys are per person and kept for 24 hours. The app sends a new key
 * for every action a person starts.
 */
@Component
@Order(10)
public class IdempotencyFilter extends OncePerRequestFilter {

    public static final String HEADER = "Idempotency-Key";
    private static final Logger log = LoggerFactory.getLogger(IdempotencyFilter.class);
    private static final Set<String> METHODS = Set.of("POST", "PUT", "PATCH", "DELETE");
    private static final Pattern KEY = Pattern.compile("[A-Za-z0-9_.:-]{8,100}");
    private static final int MAX_STORED_BODY = 1_000_000;
    /** A first attempt older than this that never finished (the server stopped) is forgotten. */
    private static final Duration ABANDONED = Duration.ofMinutes(2);

    private record Stored(String hash, Integer status, String contentType, String body, Instant created, Instant completed) {}

    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final ErrorWriter errors;

    public IdempotencyFilter(JdbcTemplate jdbc, Clock clock, ErrorWriter errors) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.errors = errors;
    }

    /**
     * Streamed replies (Flurry's answers as they're written) aren't remembered: the reply has to go
     * out as it's written, not be held back to be stored, and a question changes nothing.
     */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !METHODS.contains(request.getMethod()) || !request.getRequestURI().startsWith("/api/") || request.getHeader(HEADER) == null
                || request.getRequestURI().endsWith("/ai/ask/stream");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        String key = request.getHeader(HEADER).trim();
        if (!(auth != null && auth.getPrincipal() instanceof AuthUser user)) {
            chain.doFilter(request, response); // not signed in: sign-in and sign-up have their own protections
            return;
        }
        if (!KEY.matcher(key).matches()) {
            errors.write(response, 400, ErrorCode.VALIDATION_FAILED, "Bad Request", "The Idempotency-Key header must be 8–100 letters, digits or - _ . :", request.getRequestURI());
            return;
        }
        String hash = hash(request);
        Instant now = Instant.now(clock);

        if (!reserve(user.id(), key, hash, now)) {
            Stored s = find(user.id(), key);
            if (s != null && s.completed() == null && s.created().isBefore(now.minus(ABANDONED))) {
                jdbc.update("DELETE FROM idempotency_keys WHERE user_id = ? AND idem_key = ?", user.id(), key);
                if (reserve(user.id(), key, hash, now)) {
                    run(user.id(), key, request, response, chain);
                    return;
                }
                s = find(user.id(), key);
            }
            if (s == null) {
                errors.write(response, 409, ErrorCode.DUPLICATE_REQUEST, "Conflict", "This request is already being handled. Wait a moment and reload.", request.getRequestURI());
            } else if (!s.hash().equals(hash)) {
                errors.write(response, 422, ErrorCode.IDEMPOTENCY_MISMATCH, "Unprocessable Entity", "This Idempotency-Key was already used for a different request.", request.getRequestURI());
            } else if (s.completed() == null) {
                response.setHeader("Retry-After", "2");
                errors.write(response, 409, ErrorCode.DUPLICATE_REQUEST, "Conflict", "The same request is still being handled. It won’t be done twice.", request.getRequestURI());
            } else {
                // Done before: send the same answer again, without doing it twice.
                response.setStatus(s.status());
                if (s.contentType() != null) response.setContentType(s.contentType());
                response.setHeader("Idempotent-Replayed", "true");
                if (s.body() != null) response.getOutputStream().write(s.body().getBytes(StandardCharsets.UTF_8));
            }
            return;
        }
        run(user.id(), key, request, response, chain);
    }

    private void run(Long userId, String key, HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        ContentCachingResponseWrapper wrapped = new ContentCachingResponseWrapper(response);
        boolean stored = false;
        try {
            chain.doFilter(request, wrapped);
            int status = wrapped.getStatus();
            byte[] body = wrapped.getContentAsByteArray();
            // Server errors aren't remembered: a retry should be allowed to succeed.
            if (status < 500 && body.length <= MAX_STORED_BODY) {
                jdbc.update("UPDATE idempotency_keys SET status_code = ?, content_type = ?, response_body = ?, completed_at = ? WHERE user_id = ? AND idem_key = ?",
                        status, wrapped.getContentType(), new String(body, StandardCharsets.UTF_8), Timestamp.from(Instant.now(clock)), userId, key);
                stored = true;
            }
        } finally {
            if (!stored) {
                try {
                    jdbc.update("DELETE FROM idempotency_keys WHERE user_id = ? AND idem_key = ?", userId, key);
                } catch (RuntimeException e) {
                    log.warn("Couldn't release idempotency key: {}", e.getMessage());
                }
            }
            wrapped.copyBodyToResponse();
        }
    }

    private boolean reserve(Long userId, String key, String hash, Instant now) {
        try {
            jdbc.update("INSERT INTO idempotency_keys (user_id, idem_key, request_hash, created_at) VALUES (?, ?, ?, ?)", userId, key, hash, Timestamp.from(now));
            return true;
        } catch (DuplicateKeyException taken) {
            return false;
        }
    }

    private Stored find(Long userId, String key) {
        List<Stored> rows = jdbc.query("SELECT request_hash, status_code, content_type, response_body, created_at, completed_at FROM idempotency_keys WHERE user_id = ? AND idem_key = ?",
                (rs, i) -> {
                    Timestamp done = rs.getTimestamp("completed_at");
                    int status = rs.getInt("status_code");
                    return new Stored(rs.getString("request_hash"), rs.wasNull() ? null : status, rs.getString("content_type"), rs.getString("response_body"),
                            rs.getTimestamp("created_at").toInstant(), done == null ? null : done.toInstant());
                }, userId, key);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /** Method, path, query and body (for uploads, their size and type instead of the bytes). */
    private static String hash(HttpServletRequest request) {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            sha.update((request.getMethod() + " " + request.getRequestURI() + "?" + (request.getQueryString() == null ? "" : request.getQueryString()) + "\n").getBytes(StandardCharsets.UTF_8));
            CachedBodyRequest cached = cachedBody(request);
            if (cached != null) sha.update(cached.body());
            else sha.update((request.getContentType() + ";" + request.getContentLengthLong()).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(sha.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The body read by {@link RequestSizeFilter}, under whatever wrappers Spring Security added since. */
    private static CachedBodyRequest cachedBody(ServletRequest request) {
        ServletRequest r = request;
        while (r != null) {
            if (r instanceof CachedBodyRequest c) return c;
            r = r instanceof ServletRequestWrapper w ? w.getRequest() : null;
        }
        return null;
    }

    /** Keys are kept for a day. */
    @Scheduled(fixedDelay = 60 * 60 * 1000, initialDelay = 5 * 60 * 1000)
    public void forgetOld() {
        int n = jdbc.update("DELETE FROM idempotency_keys WHERE created_at < ?", Timestamp.from(Instant.now(clock).minus(Duration.ofDays(1))));
        if (n > 0) log.debug("Forgot {} idempotency keys", n);
    }
}
