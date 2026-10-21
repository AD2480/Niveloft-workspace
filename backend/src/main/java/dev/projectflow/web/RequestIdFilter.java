package dev.projectflow.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Gives every request an id (the caller's X-Request-Id if it's safe, otherwise a new one), puts it
 * in every log line of that request and in the response header and error bodies, and logs failed
 * and slow API calls. A person can quote the id from an error message and it leads straight to
 * the log lines.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Request-Id";
    private static final Pattern SAFE = Pattern.compile("[A-Za-z0-9._-]{8,64}");
    private static final long SLOW_MS = 2000;
    private static final Logger log = LoggerFactory.getLogger("projectflow.requests");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        String given = request.getHeader(HEADER);
        String id = given != null && SAFE.matcher(given).matches() ? given : UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        MDC.put("requestId", id);
        response.setHeader(HEADER, id);
        long start = System.nanoTime();
        try {
            chain.doFilter(request, response);
        } finally {
            long ms = (System.nanoTime() - start) / 1_000_000;
            String uri = request.getRequestURI();
            // Streams stay open by design: not slow requests.
            if (uri.startsWith("/api/") && !uri.equals("/api/events/stream") && !uri.endsWith("/ai/ask/stream")) {
                int status = response.getStatus();
                if (status >= 500) log.warn("{} {} -> {} in {} ms", request.getMethod(), uri, status, ms);
                else if (ms > SLOW_MS) log.warn("Slow: {} {} -> {} in {} ms", request.getMethod(), uri, status, ms);
                else if (log.isDebugEnabled()) log.debug("{} {} -> {} in {} ms", request.getMethod(), uri, status, ms);
            }
            MDC.remove("requestId");
        }
    }
}
