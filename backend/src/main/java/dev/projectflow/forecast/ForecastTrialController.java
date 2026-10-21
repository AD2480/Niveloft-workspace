package dev.projectflow.forecast;

import dev.projectflow.web.ApiResponse;
import dev.projectflow.web.dto.Dto;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The forecast model trial for a project (see {@link ForecastTrialService}): any member may see it. */
@RestController
@RequestMapping("/api/projects/{projectId}/forecast/trial")
public class ForecastTrialController {

    private final ForecastTrialService trial;

    public ForecastTrialController(ForecastTrialService trial) {
        this.trial = trial;
    }

    @GetMapping
    @PreAuthorize("@projectAccess.isMember(#projectId)")
    public ApiResponse<Dto.ForecastTrial> trial(@PathVariable Long projectId) {
        return ApiResponse.ok(trial.trial(projectId));
    }
}
