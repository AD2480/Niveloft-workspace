package dev.projectflow.security;

import dev.projectflow.config.AppProperties;
import dev.projectflow.config.OpsProperties;
import dev.projectflow.web.error.ErrorCode;
import dev.projectflow.web.error.ErrorWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Set;
import org.springframework.core.annotation.Order;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * API rate limits (sliding windows, counted in {@link RateCounts}: shared by every API instance in
 * the database by default in production): per signed-in person for all calls, for changes and for
 * uploads, and per IP address for calls without a sign-in. Over the limit, the answer is 429 with a
 * Retry-After header, and the app waits before trying again.
 *
 * <p>Runs after Spring Security (order 0 &gt; its -100), so it knows who is signed in. Sign-in and
 * sign-up have their own, stricter limits ({@link RateLimiter}).
 */
@Component
@Order(0)
public class ApiRateLimitFilter extends OncePerRequestFilter {

    private static final Set<String> WRITES = Set.of("POST", "PUT", "PATCH", "DELETE");

    private final boolean enabled;
    private final OpsProperties.Limits limits;
    private final int proxies;
    private final RateCounts counts;
    private final ErrorWriter errors;

    public ApiRateLimitFilter(AppProperties props, OpsProperties ops, RateCounts counts, ErrorWriter errors) {
        this.limits = ops.limitsOrDefault();
        this.enabled = (props.botProtection() == null || props.botProtection().limitsOn()) && limits.rpm() > 0;
        this.proxies = props.botProtection() == null ? 1 : props.botProtection().proxies();
        this.counts = counts;
        this.errors = errors;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String uri = request.getRequestURI();
        return !enabled || !uri.startsWith("/api/") || uri.equals("/api/events/stream") || "OPTIONS".equals(request.getMethod());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        Long userId = auth != null && auth.getPrincipal() instanceof AuthUser u ? u.id() : null;
        long wait;
        if (userId != null) {
            wait = take("u:" + userId, limits.rpm(), 60_000);
            if (wait == 0 && WRITES.contains(request.getMethod())) wait = take("w:" + userId, limits.writesPerMin(), 60_000);
            String type = request.getContentType();
            if (wait == 0 && type != null && type.startsWith("multipart/")) wait = take("f:" + userId, limits.uploadsPerHr(), 3_600_000);
        } else {
            wait = take("ip:" + ClientInfo.of(request, proxies).limitKey(), limits.anonymousRpm(), 60_000);
        }
        if (wait > 0) {
            long seconds = Math.max(1, (wait + 999) / 1000);
            response.setHeader("Retry-After", String.valueOf(seconds));
            errors.write(response, 429, ErrorCode.RATE_LIMITED, "Too Many Requests",
                    "Too many requests in a short time. Please wait " + seconds + (seconds == 1 ? " second" : " seconds") + " and try again.", request.getRequestURI());
            return;
        }
        chain.doFilter(request, response);
    }

    private long take(String key, int limit, long periodMs) {
        if (limit <= 0) return 0;
        return counts.take("api:" + key, limit, periodMs);
    }
}
