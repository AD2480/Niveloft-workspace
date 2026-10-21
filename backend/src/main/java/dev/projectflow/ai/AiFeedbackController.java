package dev.projectflow.ai;

import dev.projectflow.ops.AuditLog;
import dev.projectflow.security.CurrentUser;
import dev.projectflow.web.ApiResponse;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import jakarta.validation.Valid;
import java.nio.charset.StandardCharsets;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** Corrections to Flurry's answers: given by anyone who asked, read and exported by owners and managers. */
@RestController
@RequestMapping("/api/projects/{projectId}/ai/feedback")
public class AiFeedbackController {

    private final AiFeedbackService feedback;
    private final AuditLog audit;

    public AiFeedbackController(AiFeedbackService feedback, AuditLog audit) {
        this.feedback = feedback;
        this.audit = audit;
    }

    @PostMapping
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<Void> record(@PathVariable Long projectId, @Valid @RequestBody Requests.AiFeedback req) {
        feedback.record(projectId, req);
        return ResponseEntity.noContent().build();
    }

    @GetMapping
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.AiFeedbackSummary> summary(@PathVariable Long projectId, @RequestParam(defaultValue = "90") int days) {
        return ApiResponse.ok(feedback.summary(projectId, days));
    }

    /** The wrong answers as draft eval cases (JSON lines), for the ml/ tool eval. */
    @GetMapping(value = "/cases.jsonl", produces = "application/x-ndjson")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<byte[]> cases(@PathVariable Long projectId, @RequestParam(defaultValue = "180") int days) {
        byte[] body = feedback.exportCases(projectId, days).getBytes(StandardCharsets.UTF_8);
        audit.record(CurrentUser.id(), projectId, "ai.feedback.exported", "corrections as eval cases", AuditLog.OK, body.length + " bytes");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename("flurry-corrections.jsonl").build().toString())
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .contentType(MediaType.parseMediaType("application/x-ndjson"))
                .body(body);
    }
}
