package dev.projectflow.web;

import dev.projectflow.service.DocumentService;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** A project's documents: listed, read, written, approved for Flurry, deleted. Each call checks membership and role. */
@RestController
@RequestMapping("/api/projects/{projectId}/documents")
public class DocumentController {

    private final DocumentService documents;

    public DocumentController(DocumentService documents) {
        this.documents = documents;
    }

    @GetMapping
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<List<Dto.DocumentSummary>> list(@PathVariable Long projectId) {
        return ApiResponse.ok(documents.list(projectId));
    }

    @PostMapping
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.Document> create(@PathVariable Long projectId, @Valid @RequestBody Requests.DocumentRequest req) {
        Dto.Document d = documents.create(projectId, req);
        return ApiResponse.ok(d, "Saved as a draft. Flurry reads it once an owner or manager approves it.");
    }

    @GetMapping("/{id}")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.Document> get(@PathVariable Long projectId, @PathVariable Long id) {
        return ApiResponse.ok(documents.get(projectId, id));
    }

    @PutMapping("/{id}")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.Document> update(@PathVariable Long projectId, @PathVariable Long id, @Valid @RequestBody Requests.DocumentRequest req) {
        Dto.Document d = documents.update(projectId, id, req);
        return ApiResponse.ok(d, "Saved.");
    }

    @PutMapping("/{id}/approval")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.Document> approve(@PathVariable Long projectId, @PathVariable Long id, @RequestBody Requests.DocumentApproval req) {
        Dto.Document d = documents.approve(projectId, id, req.approved());
        return ApiResponse.ok(d, req.approved() ? "Approved: Flurry can search it now." : "Approval withdrawn: Flurry no longer reads it.");
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<Void> delete(@PathVariable Long projectId, @PathVariable Long id) {
        documents.delete(projectId, id);
        return ResponseEntity.noContent().build();
    }
}
