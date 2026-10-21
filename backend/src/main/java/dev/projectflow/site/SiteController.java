package dev.projectflow.site;

import dev.projectflow.config.AppProperties;
import dev.projectflow.security.ClientInfo;
import dev.projectflow.web.ApiResponse;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * The Contact form and form counts (open to everyone, rate-limited), the operator's Site health
 * page (operators only) and the Arena's votes (signed in, project members).
 */
@RestController
@RequestMapping("/api")
public class SiteController {

    private final SiteService site;
    private final int proxies;

    public SiteController(SiteService site, AppProperties props) {
        this.site = site;
        this.proxies = props.botProtection() == null ? 1 : props.botProtection().proxies();
    }

    @PostMapping("/contact")
    public ResponseEntity<ApiResponse<Dto.ContactReceipt>> contact(@Valid @RequestBody Requests.Contact body, HttpServletRequest request) {
        Dto.ContactReceipt receipt = site.contact(body, ClientInfo.of(request, proxies));
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(receipt, "Message sent."));
    }

    @PostMapping("/metrics/forms")
    public ResponseEntity<Void> formMetrics(@Valid @RequestBody Requests.FormMetrics body, HttpServletRequest request) {
        site.recordFormMetrics(body, ClientInfo.of(request, proxies));
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/site-health")
    public ApiResponse<Dto.SiteHealth> health(@RequestParam(defaultValue = "30") int days) {
        return ApiResponse.ok(site.health(days));
    }

    @PatchMapping("/site-health/contact/{id}")
    public ApiResponse<Dto.ContactMessage> handled(@PathVariable long id, @RequestBody Requests.ContactHandled body) {
        return ApiResponse.ok(site.markHandled(id, body.handled()));
    }

    @PostMapping("/arena/votes")
    public ResponseEntity<ApiResponse<Dto.ArenaScoreboard>> vote(@Valid @RequestBody Requests.ArenaVote body) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(site.vote(body), "Vote counted."));
    }

    @GetMapping("/arena/scoreboard")
    public ApiResponse<Dto.ArenaScoreboard> scoreboard() {
        return ApiResponse.ok(site.scoreboard());
    }
}
