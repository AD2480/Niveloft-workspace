package dev.projectflow.web;

import dev.projectflow.config.AppProperties;
import dev.projectflow.security.ClientInfo;
import dev.projectflow.security.RateLimiter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.Size;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Errors that happen in people's browsers (a crash in a page, a failed script), reported by the
 * app so they show up in this server's log next to the server's own errors. Nothing is stored,
 * and the text is shortened and kept on one line so it can't forge log entries.
 */
@RestController
public class ClientErrorController {

    private static final Logger log = LoggerFactory.getLogger("projectflow.browser");

    public record ClientError(@Size(max = 2000) String message, @Size(max = 8000) String stack, @Size(max = 500) String url,
                              @Size(max = 64) String requestId, @Size(max = 40) String kind) {}

    private final RateLimiter limiter;
    private final int proxies;

    public ClientErrorController(RateLimiter limiter, AppProperties props) {
        this.limiter = limiter;
        this.proxies = props.botProtection() == null ? 1 : props.botProtection().proxies();
    }

    @PostMapping("/api/client-errors")
    public ResponseEntity<Void> report(@RequestBody ClientError e, HttpServletRequest request) {
        limiter.check("client-error", ClientInfo.of(request, proxies).limitKey(), 20, Duration.ofMinutes(1));
        log.warn("Browser {} at {} (request {}): {} | {} | {}", LogText.oneLine(e.kind(), 40), LogText.oneLine(e.url(), 300), LogText.oneLine(e.requestId(), 64), LogText.oneLine(e.message(), 500),
                LogText.oneLine(e.stack(), 1500), LogText.oneLine(request.getHeader("User-Agent"), 200));
        return ResponseEntity.noContent().build();
    }

}
