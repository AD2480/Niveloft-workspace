package dev.projectflow.live;

import dev.projectflow.security.CurrentUser;
import dev.projectflow.web.ApiResponse;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** Live updates over Server-Sent Events. See {@link LiveUpdateService} for the ticket flow. */
@RestController
@RequestMapping("/api/events")
public class LiveController {

    private final LiveUpdateService live;

    public LiveController(LiveUpdateService live) {
        this.live = live;
    }

    /** Authenticated: a one-time ticket for opening the event stream. */
    @PostMapping("/ticket")
    public ApiResponse<Map<String, Object>> ticket() {
        return ApiResponse.ok(Map.of("ticket", live.issueTicket(CurrentUser.id(), CurrentUser.sessionId()), "expiresIn", LiveUpdateService.TICKET_SECONDS));
    }

    /**
     * Public route, but only a valid ticket opens a stream. An invalid ticket gets a bare 401
     * (no JSON body, since the client asked for text/event-stream) and the client requests a new ticket.
     */
    @GetMapping("/stream")
    public ResponseEntity<SseEmitter> stream(@RequestParam(defaultValue = "") String ticket) {
        return live.open(ticket)
                .map(emitter -> ResponseEntity.ok().contentType(MediaType.TEXT_EVENT_STREAM).body(emitter))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.UNAUTHORIZED).build());
    }
}
