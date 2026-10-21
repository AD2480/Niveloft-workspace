package dev.projectflow.web;

import dev.projectflow.ops.AuditLog;
import dev.projectflow.ops.Operators;
import dev.projectflow.ops.OpsSwitches;
import dev.projectflow.security.CurrentUser;
import dev.projectflow.service.AccountService;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Emergency controls for the people named in OPERATOR_EMAILS (everyone else gets 403): switch a
 * feature off without a deploy, suspend an account, sign everyone out, and read the audit log.
 * Every change is itself recorded in the audit log.
 */
@RestController
@RequestMapping("/api/ops")
public class OpsController {

    private final Operators operators;
    private final OpsSwitches switches;
    private final AccountService accounts;
    private final AuditLog audit;

    public OpsController(Operators operators, OpsSwitches switches, AccountService accounts, AuditLog audit) {
        this.operators = operators;
        this.switches = switches;
        this.accounts = accounts;
        this.audit = audit;
    }

    @GetMapping("/switches")
    public ApiResponse<List<Dto.OpsSwitch>> switches() {
        operators.require();
        return ApiResponse.ok(switches.list().stream().map(OpsController::dto).toList());
    }

    @PutMapping("/switches/{name}")
    public ApiResponse<Dto.OpsSwitch> setSwitch(@PathVariable String name, @Valid @RequestBody Requests.SetSwitch req) {
        operators.require();
        OpsSwitches.Switch s = switches.set(name, req.enabled(), req.reason(), CurrentUser.id());
        audit.record(CurrentUser.id(), null, "ops.switch", name, AuditLog.OK, (req.enabled() ? "on" : "off") + (s.reason() == null ? "" : ": " + s.reason()));
        return ApiResponse.ok(dto(s), "“" + s.stops() + "” is " + (s.enabled() ? "on." : "off."));
    }

    @PostMapping("/accounts/suspend")
    public ApiResponse<Void> suspend(@Valid @RequestBody Requests.AccountAction req) {
        operators.require();
        accounts.suspend(req, true);
        return ApiResponse.ok(null, "The account is suspended and was signed out everywhere.");
    }

    @PostMapping("/accounts/unsuspend")
    public ApiResponse<Void> unsuspend(@Valid @RequestBody Requests.AccountAction req) {
        operators.require();
        accounts.suspend(req, false);
        return ApiResponse.ok(null, "The account can sign in again.");
    }

    /** Signs out every session except the operator's own. */
    @PostMapping("/sessions/end-all")
    public ApiResponse<Void> endAllSessions(@Valid @RequestBody Requests.EndAllSessions req) {
        operators.require();
        int ended = accounts.endAllSessions(req);
        return ApiResponse.ok(null, ended + (ended == 1 ? " session was" : " sessions were") + " signed out.");
    }

    @GetMapping("/audit")
    public ApiResponse<List<Dto.AuditEvent>> audit(@RequestParam(defaultValue = "100") int limit, @RequestParam(required = false) String action) {
        operators.require();
        return ApiResponse.ok(audit.recent(limit, action).stream()
                .map(e -> new Dto.AuditEvent(e.id(), e.at(), e.actorName() == null ? (e.actorId() == null ? "Niveloft" : "Unknown") : e.actorName(),
                        e.action(), (e.projectId() == null ? "" : "project " + e.projectId() + (e.target() == null ? "" : ", ")) + (e.target() == null ? "" : e.target()),
                        e.outcome(), e.detail()))
                .toList());
    }

    private static Dto.OpsSwitch dto(OpsSwitches.Switch s) {
        return new Dto.OpsSwitch(s.name(), s.stops(), s.enabled(), s.reason(), s.changedAt());
    }
}
