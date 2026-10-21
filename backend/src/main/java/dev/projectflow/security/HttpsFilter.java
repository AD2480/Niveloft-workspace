package dev.projectflow.security;

import dev.projectflow.config.AppProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * HTTPS only. Hosting proxies end TLS and pass the original scheme in {@code X-Forwarded-Proto}.
 * With {@code REQUIRE_HTTPS=true}, plain-HTTP requests are redirected to HTTPS (308 keeps the method
 * and body). Over HTTPS, responses carry HSTS so browsers never try plain HTTP again. The health
 * check stays reachable over HTTP for the host's own probes.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 5)
public class HttpsFilter extends OncePerRequestFilter {

    static final String HSTS = "max-age=31536000; includeSubDomains";

    private final boolean required;

    public HttpsFilter(AppProperties props) {
        this.required = props.https() != null && props.https().required();
    }

    static boolean secure(HttpServletRequest request) {
        return ClientInfo.overHttps(request);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (secure(request)) {
            response.setHeader("Strict-Transport-Security", HSTS);
        } else if (required && !request.getRequestURI().startsWith("/actuator/health")) {
            String host = request.getHeader("Host");
            if (host != null && host.matches("[A-Za-z0-9.\\-:\\[\\]]{1,255}")) {
                String query = request.getQueryString();
                response.setStatus(308);
                response.setHeader("Location", "https://" + host + request.getRequestURI() + (query == null ? "" : "?" + query));
                return;
            }
            response.sendError(HttpServletResponse.SC_FORBIDDEN, "HTTPS is required.");
            return;
        }
        chain.doFilter(request, response);
    }
}
