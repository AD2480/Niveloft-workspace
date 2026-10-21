package dev.projectflow.ai;

import dev.projectflow.security.CurrentUser;
import dev.projectflow.web.ApiResponse;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/**
 * AI assistance endpoints. Every call checks the caller's access first; when no provider is
 * configured the calls fail with AI_UNAVAILABLE rather than returning anything invented.
 */
@RestController
@RequestMapping("/api")
public class AiController {

    private final AiService ai;
    private final VoiceService voice;

    private final dev.projectflow.ops.OpsSwitches switches;
    private final AskStreams streams;

    public AiController(AiService ai, VoiceService voice, dev.projectflow.ops.OpsSwitches switches, AskStreams streams) {
        this.ai = ai;
        this.voice = voice;
        this.switches = switches;
        this.streams = streams;
    }

    /**
     * Flurry's answer read aloud by the server's voice (ElevenLabs), as MP3. Unavailable unless the
     * server has a voice set up; the browser's own voice is the fallback.
     */
    @PostMapping("/ai/speech")
    public ResponseEntity<byte[]> speech(@Valid @RequestBody Requests.Speech request) {
        switches.require("voice");
        byte[] audio = voice.speak(CurrentUser.id(), request.text());
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("audio/mpeg")).cacheControl(CacheControl.noStore()).body(audio);
    }

    @GetMapping("/ai/status")
    public ApiResponse<Dto.AiStatus> status() {
        return ApiResponse.ok(ai.status());
    }

    /** The models this server can answer with right now (the Arena lets people compare them). */
    @GetMapping("/ai/models")
    public ApiResponse<java.util.List<Dto.AiModel>> models() {
        return ApiResponse.ok(ai.models());
    }

    @PostMapping("/tasks/{taskId}/ai/review-assist")
    @PreAuthorize("@projectAccess.canAccessTask(#taskId)")
    public ApiResponse<Dto.AiReviewAssist> reviewAssist(@PathVariable Long taskId) {
        return ApiResponse.ok(ai.reviewAssist(taskId), "Draft notes ready. Check them before using.");
    }

    @PostMapping("/tasks/{taskId}/ai/criteria")
    @PreAuthorize("@projectAccess.canAccessTask(#taskId)")
    public ApiResponse<Dto.AiCriteriaSuggestion> criteria(@PathVariable Long taskId) {
        return ApiResponse.ok(ai.suggestCriteria(taskId));
    }

    @PostMapping("/projects/{projectId}/ai/summary")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.AiSummary> summary(@PathVariable Long projectId) {
        return ApiResponse.ok(ai.projectSummary(projectId));
    }

    /** Flurry's "Plan a project": draft tasks from a brief, for anyone who may create tasks. Nothing is created here. */
    @PostMapping("/projects/{projectId}/ai/plan")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.AiPlan> plan(@PathVariable Long projectId, @Valid @RequestBody Requests.AiPlan request) {
        return ApiResponse.ok(ai.planProject(projectId, request));
    }

    /** "Ask about this project": answers from the project's records, for any member. */
    @PostMapping("/projects/{projectId}/ai/ask")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.AiAnswer> ask(@PathVariable Long projectId, @Valid @RequestBody Requests.AiAsk request) {
        return ApiResponse.ok(ai.askProject(projectId, request));
    }

    /**
     * The same question answered as server-sent events (see {@link AskStreams}): each lookup as it's
     * made, the answer's words as they're written, then the checked answer. A refusal (no AI,
     * limits, not a member) is an ordinary error response before the stream opens.
     * {@code requestId}, chosen by the browser, lets the asker stop it.
     */
    @PostMapping(value = "/projects/{projectId}/ai/ask/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<org.springframework.web.servlet.mvc.method.annotation.SseEmitter> askStream(
            @PathVariable Long projectId, @Valid @RequestBody Requests.AiAsk request, @RequestParam(required = false) String requestId) {
        var emitter = streams.start(projectId, request, requestId);
        return ResponseEntity.ok()
                .contentType(MediaType.TEXT_EVENT_STREAM)
                .cacheControl(CacheControl.noCache().noTransform())
                // Proxies that buffer (nginx) pass the events on as they come.
                .header("X-Accel-Buffering", "no")
                .body(emitter);
    }

    /** Stops the caller's own streamed question; nothing else. Stopping one that already ended does nothing. */
    @DeleteMapping("/projects/{projectId}/ai/ask/{requestId}")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<Void> stopAsk(@PathVariable Long projectId, @PathVariable String requestId) {
        streams.stop(CurrentUser.id(), requestId);
        return ResponseEntity.noContent().build();
    }
}
