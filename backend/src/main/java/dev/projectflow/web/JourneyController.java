package dev.projectflow.web;

import dev.projectflow.service.JourneyService;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

/** The blocker journey's counts: recorded by any member's page, read by owners and managers. */
@RestController
@RequestMapping("/api/projects/{projectId}/journey")
public class JourneyController {

    private final JourneyService journey;

    public JourneyController(JourneyService journey) {
        this.journey = journey;
    }

    @PostMapping
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ResponseEntity<Void> record(@PathVariable Long projectId, @Valid @RequestBody Requests.JourneyStep req) {
        journey.record(projectId, req.step(), req.blockerKind(), req.option());
        return ResponseEntity.noContent().build();
    }

    @GetMapping
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.JourneySummary> summary(@PathVariable Long projectId, @RequestParam(defaultValue = "30") int days) {
        return ApiResponse.ok(journey.summary(projectId, days));
    }
}
