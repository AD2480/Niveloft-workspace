package dev.projectflow.web;

import dev.projectflow.config.OpsProperties;
import dev.projectflow.web.error.ErrorCode;
import dev.projectflow.web.error.ErrorWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStream;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Refuses JSON request bodies over the limit (413) before anything reads them, whether or not
 * the client said how big they are. File uploads have their own limits (10 MB a file, 5 files).
 */
@Component
@Order(-200)
public class RequestSizeFilter extends OncePerRequestFilter {

    private final int max;
    private final ErrorWriter errors;

    public RequestSizeFilter(OpsProperties ops, ErrorWriter errors) {
        this.max = ops.limitsOrDefault().jsonBytes();
        this.errors = errors;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String type = request.getContentType();
        return max <= 0 || !request.getRequestURI().startsWith("/api/") || type == null || type.startsWith("multipart/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        long declared = request.getContentLengthLong();
        if (declared > max) {
            tooBig(request, response);
            return;
        }
        byte[] body;
        try (InputStream in = request.getInputStream()) {
            body = in.readNBytes(max + 1);
        }
        if (body.length > max) {
            tooBig(request, response);
            return;
        }
        chain.doFilter(new CachedBodyRequest(request, body), response);
    }

    private void tooBig(HttpServletRequest request, HttpServletResponse response) throws IOException {
        errors.write(response, 413, ErrorCode.LIMIT_REACHED, "Payload Too Large", "This request is too large (the limit is " + max / 1024 + " KB).", request.getRequestURI());
    }
}
