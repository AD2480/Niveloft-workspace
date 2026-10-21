package dev.projectflow.workflow;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * End-to-end tests of the rules that must hold on the server no matter what the UI does:
 * role checks, the submit → review → approve workflow, evidence access and edit conflicts.
 *
 * <p>Each test builds its own project with six fresh users (owner, manager, two members,
 * a viewer and an outsider) through the public API, so tests don't depend on each other.
 */
@SpringBootTest
@AutoConfigureMockMvc
class SubmissionReviewWorkflowTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;

    record Account(long id, String token) {}

    Account owner, manager, maya, nate, viewer, outsider;
    long projectId;

    // ------------------------------------------------------------------ setup

    @BeforeEach
    void setUp() throws Exception {
        int n = SEQ.incrementAndGet();
        owner = register("Olivia Owner", "owner" + n);
        manager = register("Mark Manager", "manager" + n);
        maya = register("Maya Member", "maya" + n);
        nate = register("Nate Member", "nate" + n);
        viewer = register("Vera Viewer", "viewer" + n);
        outsider = register("Otto Outsider", "otto" + n);

        String project = call(owner, post("/api/projects"), Map.of(
                "name", "Workflow Test " + n, "key", "WT" + (n % 1000), "startDate", LocalDate.now().toString()))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        projectId = ((Number) JsonPath.read(project, "$.data.id")).longValue();

        join(manager, "MANAGER", "manager" + n);
        join(maya, "MEMBER", "maya" + n);
        join(nate, "MEMBER", "nate" + n);
        join(viewer, "VIEWER", "viewer" + n);
    }

    private Account register(String name, String handle) throws Exception {
        String body = mvc.perform(post("/api/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("name", name, "email", handle + "@test.dev", "password", "Harbor-Quill-42", "acceptTerms", true))))
                .andExpect(status().is2xxSuccessful()).andReturn().getResponse().getContentAsString();
        return new Account(((Number) JsonPath.read(body, "$.data.user.id")).longValue(), JsonPath.read(body, "$.data.token"));
    }

    private void join(Account who, String role, String handle) throws Exception {
        call(owner, post("/api/projects/" + projectId + "/invitations"), Map.of("email", handle + "@test.dev", "role", role))
                .andExpect(status().isCreated());
        String mine = call(who, get("/api/invitations/mine"), null).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        List<Number> ids = JsonPath.read(mine, "$.data[?(@.projectId == " + projectId + ")].id");
        call(who, post("/api/invitations/" + ids.get(0).longValue() + "/accept"), null).andExpect(status().isOk());
    }

    private ResultActions call(Account who, MockHttpServletRequestBuilder req, Object body) throws Exception {
        if (who != null) req.header("Authorization", "Bearer " + who.token());
        if (body != null) req.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
        return mvc.perform(req);
    }

    private String data(ResultActions r) throws Exception {
        return r.andReturn().getResponse().getContentAsString();
    }

    /** Creates a task assigned to {@code assignee} with two criteria and one checklist item. */
    private long createTask(Account assignee) throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("title", "Build the thing");
        body.put("priority", "HIGH");
        body.put("assigneeId", assignee.id());
        body.put("acceptanceCriteria", List.of("Form validates input", "Errors are announced to screen readers"));
        body.put("checklist", List.of("Write tests"));
        String res = data(call(owner, post("/api/projects/" + projectId + "/tasks"), body).andExpect(status().isCreated()));
        return ((Number) JsonPath.read(res, "$.data.id")).longValue();
    }

    private void tickAll(Account who, long taskId) throws Exception {
        String task = data(call(who, get("/api/tasks/" + taskId), null).andExpect(status().isOk()));
        List<Number> ids = JsonPath.read(task, "$.data.checklist[*].id");
        for (Number id : ids) {
            call(who, patch("/api/checklist-items/" + id.longValue()), Map.of("done", true)).andExpect(status().isOk());
        }
    }

    private ResultActions submit(Account who, long taskId, List<Map<String, String>> evidence, MockMultipartFile... files) throws Exception {
        MockMultipartFile data = new MockMultipartFile("data", "", MediaType.APPLICATION_JSON_VALUE,
                json.writeValueAsBytes(Map.of("notes", "Implemented and tested locally.", "evidence", evidence)));
        var req = multipart("/api/tasks/" + taskId + "/submissions").file(data);
        for (MockMultipartFile f : files) req.file(f);
        req.header("Authorization", "Bearer " + who.token());
        return mvc.perform(req);
    }

    private static List<Map<String, String>> repoLink() {
        return List.of(Map.of("kind", "REPOSITORY", "label", "PR #12", "url", "https://github.com/example/projectflow/pull/12"));
    }

    private String latestSubmission(Account who, long taskId) throws Exception {
        return data(call(who, get("/api/tasks/" + taskId + "/submissions"), null).andExpect(status().isOk()));
    }

    private List<Map<String, Object>> verdicts(String submissions, boolean allMet) {
        List<Number> ids = JsonPath.read(submissions, "$.data[0].criteria[*].id");
        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = 0; i < ids.size(); i++) {
            boolean met = allMet || i < ids.size() - 1;
            out.add(Map.of("submissionCriterionId", ids.get(i).longValue(), "met", met, "note", met ? "" : "Not announced yet"));
        }
        return out;
    }

    // ------------------------------------------------------------------ roles

    @Test
    @DisplayName("Viewers cannot create tasks; outsiders cannot read the project; unknown ids are 404")
    void roleBoundaries() throws Exception {
        call(viewer, post("/api/projects/" + projectId + "/tasks"), Map.of("title", "Sneaky task", "priority", "LOW"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("FORBIDDEN"));
        call(outsider, get("/api/projects/" + projectId), null)
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.success").value(false));
        call(owner, get("/api/projects/999999"), null).andExpect(status().isNotFound());
        call(null, get("/api/projects"), null).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("Members cannot assign new tasks to other people")
    void memberCannotAssignOthers() throws Exception {
        call(maya, post("/api/projects/" + projectId + "/tasks"), Map.of("title", "Task for Nate", "priority", "LOW", "assigneeId", nate.id()))
                .andExpect(status().isForbidden());
    }

    // --------------------------------------------------------------- workflow

    @Test
    @DisplayName("In Review and Done cannot be reached by drag-and-drop or a direct status change")
    void cannotBypassApproval() throws Exception {
        long taskId = createTask(maya);
        call(maya, patch("/api/tasks/" + taskId + "/status"), Map.of("status", "DONE"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("WORKFLOW_VIOLATION"));
        call(owner, patch("/api/tasks/" + taskId + "/status"), Map.of("status", "DONE"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("WORKFLOW_VIOLATION"));
        call(owner, patch("/api/tasks/" + taskId + "/move"), Map.of("status", "IN_REVIEW"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("WORKFLOW_VIOLATION"));
        call(maya, patch("/api/tasks/" + taskId + "/move"), Map.of("status", "DONE"))
                .andExpect(status().isConflict());
        // Ordinary moves still work.
        call(maya, patch("/api/tasks/" + taskId + "/move"), Map.of("status", "IN_PROGRESS"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.status").value("IN_PROGRESS"));
    }

    @Test
    @DisplayName("Only the assignee submits; the checklist must be complete and evidence present")
    void submissionPreconditions() throws Exception {
        long taskId = createTask(maya);
        submit(nate, taskId, repoLink()).andExpect(status().isForbidden());
        submit(viewer, taskId, repoLink()).andExpect(status().isForbidden());
        submit(maya, taskId, repoLink())
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("WORKFLOW_VIOLATION"));

        tickAll(maya, taskId);
        submit(maya, taskId, List.of())
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.evidence").exists());
        submit(maya, taskId, List.of(Map.of("kind", "LINK", "label", "", "url", "javascript:alert(1)")))
                .andExpect(status().isBadRequest());

        submit(maya, taskId, repoLink())
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.version").value(1))
                .andExpect(jsonPath("$.data.criteria.length()").value(2))
                .andExpect(jsonPath("$.data.evidence[0].kind").value("REPOSITORY"));
        call(maya, get("/api/tasks/" + taskId), null).andExpect(jsonPath("$.data.status").value("IN_REVIEW"));

        // A second submission while one is pending is rejected, and the checklist is locked.
        submit(maya, taskId, repoLink()).andExpect(status().isConflict());
        String task = data(call(maya, get("/api/tasks/" + taskId), null));
        Number itemId = JsonPath.read(task, "$.data.checklist[0].id");
        call(maya, patch("/api/checklist-items/" + itemId.longValue()), Map.of("done", false)).andExpect(status().isConflict());
    }

    @Test
    @DisplayName("Submit → request changes → resubmit → approve, with every version and review kept")
    void fullReviewCycle() throws Exception {
        long taskId = createTask(maya);
        tickAll(maya, taskId);
        submit(maya, taskId, repoLink()).andExpect(status().isCreated());

        String subs = latestSubmission(manager, taskId);
        long v1 = ((Number) JsonPath.read(subs, "$.data[0].id")).longValue();

        // Members and viewers can't review.
        call(nate, post("/api/submissions/" + v1 + "/review"), Map.of("decision", "APPROVED", "results", verdicts(subs, true)))
                .andExpect(status().isForbidden());
        call(viewer, post("/api/submissions/" + v1 + "/review"), Map.of("decision", "APPROVED", "results", verdicts(subs, true)))
                .andExpect(status().isForbidden());

        // Approval needs every criterion marked, and marked as met.
        call(manager, post("/api/submissions/" + v1 + "/review"), Map.of("decision", "APPROVED", "results", List.of()))
                .andExpect(status().isBadRequest());
        call(manager, post("/api/submissions/" + v1 + "/review"), Map.of("decision", "APPROVED", "results", verdicts(subs, false)))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("WORKFLOW_VIOLATION"));

        // Requesting changes needs real feedback.
        call(manager, post("/api/submissions/" + v1 + "/review"), Map.of("decision", "CHANGES_REQUESTED", "feedback", "Fix", "results", verdicts(subs, false)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.feedback").exists());
        call(manager, post("/api/submissions/" + v1 + "/review"),
                Map.of("decision", "CHANGES_REQUESTED", "feedback", "Announce errors with aria-live, then resubmit.", "results", verdicts(subs, false)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.status").value("CHANGES_REQUESTED"));
        call(maya, get("/api/tasks/" + taskId), null).andExpect(jsonPath("$.data.status").value("IN_PROGRESS"));

        // A reviewed submission can't be reviewed again.
        call(owner, post("/api/submissions/" + v1 + "/review"), Map.of("decision", "APPROVED", "results", verdicts(subs, true)))
                .andExpect(status().isConflict());

        submit(maya, taskId, repoLink()).andExpect(status().isCreated()).andExpect(jsonPath("$.data.version").value(2));
        String subs2 = latestSubmission(manager, taskId);
        long v2 = ((Number) JsonPath.read(subs2, "$.data[0].id")).longValue();
        call(manager, post("/api/submissions/" + v2 + "/review"), Map.of("decision", "APPROVED", "feedback", "Looks good.", "results", verdicts(subs2, true)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.status").value("APPROVED"));

        call(maya, get("/api/tasks/" + taskId), null)
                .andExpect(jsonPath("$.data.status").value("DONE"))
                .andExpect(jsonPath("$.data.completedAt").isNotEmpty());

        String history = latestSubmission(viewer, taskId);
        assertThat((List<?>) JsonPath.read(history, "$.data")).hasSize(2);
        assertThat((String) JsonPath.read(history, "$.data[1].status")).isEqualTo("CHANGES_REQUESTED");
        assertThat((String) JsonPath.read(history, "$.data[1].review.feedback")).contains("aria-live");
        assertThat((List<?>) JsonPath.read(history, "$.data[1].review.results")).hasSize(2);

        // Analytics sees the approval (second attempt, so not a first-time approval).
        call(owner, get("/api/projects/" + projectId + "/analytics"), null)
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.taskCounts.done").value(1));
    }

    @Test
    @DisplayName("Nobody can review their own submission, even a manager")
    void cannotReviewOwnWork() throws Exception {
        long taskId = createTask(manager);
        tickAll(manager, taskId);
        submit(manager, taskId, repoLink()).andExpect(status().isCreated());
        String subs = latestSubmission(manager, taskId);
        long id = ((Number) JsonPath.read(subs, "$.data[0].id")).longValue();
        call(manager, post("/api/submissions/" + id + "/review"), Map.of("decision", "APPROVED", "results", verdicts(subs, true)))
                .andExpect(status().isForbidden());
        call(owner, post("/api/submissions/" + id + "/review"), Map.of("decision", "APPROVED", "results", verdicts(subs, true)))
                .andExpect(status().isOk());
    }

    // --------------------------------------------------------------- evidence

    @Test
    @DisplayName("Evidence files are served only to members of the project")
    void evidenceAccess() throws Exception {
        long taskId = createTask(maya);
        tickAll(maya, taskId);
        byte[] png = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
        String res = data(submit(maya, taskId, List.of(), new MockMultipartFile("files", "screen.png", "image/png", png))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.data.evidence[0].kind").value("SCREENSHOT")));
        long fileId = ((Number) JsonPath.read(res, "$.data.evidence[0].file.id")).longValue();

        call(viewer, get("/api/files/" + fileId), null).andExpect(status().isOk());
        call(outsider, get("/api/files/" + fileId), null).andExpect(status().isForbidden());
        call(null, get("/api/files/" + fileId), null).andExpect(status().isUnauthorized());
        call(outsider, get("/api/tasks/" + taskId + "/submissions"), null).andExpect(status().isForbidden());
    }

    // ------------------------------------------------------------ concurrency

    @Test
    @DisplayName("Saving over someone else's change returns EDIT_CONFLICT instead of overwriting it")
    void editConflict() throws Exception {
        long taskId = createTask(maya);
        String task = data(call(owner, get("/api/tasks/" + taskId), null));
        long version = ((Number) JsonPath.read(task, "$.data.version")).longValue();

        Map<String, Object> first = new HashMap<>(Map.of("title", "Renamed by the owner", "priority", "HIGH", "assigneeId", maya.id(), "version", version));
        call(owner, put("/api/tasks/" + taskId), first).andExpect(status().isOk());

        Map<String, Object> stale = new HashMap<>(Map.of("title", "Renamed by Maya", "priority", "LOW", "assigneeId", maya.id(), "version", version));
        call(maya, put("/api/tasks/" + taskId), stale)
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("EDIT_CONFLICT"));
        call(maya, get("/api/tasks/" + taskId), null).andExpect(jsonPath("$.data.title").value("Renamed by the owner"));
    }

    // --------------------------------------------------------- mission control

    @Test
    @DisplayName("Mission Control explains a waiting review, and search never leaks other projects")
    void attentionAndSearch() throws Exception {
        long taskId = createTask(maya);
        tickAll(maya, taskId);
        submit(maya, taskId, repoLink()).andExpect(status().isCreated());

        String dash = data(call(manager, get("/api/dashboard"), null).andExpect(status().isOk()));
        List<String> kinds = JsonPath.read(dash, "$.data.attention[*].kind");
        assertThat(kinds).contains("REVIEW_WAITING");
        List<String> reasons = JsonPath.read(dash, "$.data.attention[?(@.kind == 'REVIEW_WAITING')].reason");
        assertThat(reasons.get(0)).contains("Maya Member").contains("2 acceptance criteria");

        // The submitter is not asked to review her own work.
        String mine = data(call(maya, get("/api/dashboard"), null).andExpect(status().isOk()));
        assertThat((List<String>) JsonPath.read(mine, "$.data.attention[*].kind")).doesNotContain("REVIEW_WAITING");

        call(maya, get("/api/search").param("q", "Build the"), null)
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.tasks[0].id").value(taskId));
        call(outsider, get("/api/search").param("q", "Build the"), null)
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.tasks.length()").value(0));
    }

    // ------------------------------------------------------------ dependencies

    private ResultActions depend(Account who, long blocked, long blocker) throws Exception {
        return call(who, post("/api/tasks/" + blocked + "/dependencies"), Map.of("blockerTaskId", blocker));
    }

    @Test
    @DisplayName("Dependencies: same project only, no self, no duplicates, cycles explained, viewers blocked")
    void dependencies() throws Exception {
        long a = createTask(maya);
        long b = createTask(maya);
        long c = createTask(maya);

        depend(owner, b, a).andExpect(status().isCreated()).andExpect(jsonPath("$.data.blocker.id").value(a));
        depend(owner, c, b).andExpect(status().isCreated());
        depend(owner, b, a).andExpect(status().isConflict());
        depend(owner, a, a).andExpect(status().isBadRequest());
        // c → a would close a → b → c → a
        depend(owner, a, c).andExpect(status().isBadRequest()).andExpect(jsonPath("$.fieldErrors.blockerTaskId").value(org.hamcrest.Matchers.containsString("loop")));
        depend(viewer, c, a).andExpect(status().isForbidden());
        depend(nate, c, a).andExpect(status().isForbidden());

        String list = data(call(viewer, get("/api/projects/" + projectId + "/dependencies"), null).andExpect(status().isOk()));
        assertThat((List<?>) JsonPath.read(list, "$.data")).hasSize(2);
        call(outsider, get("/api/projects/" + projectId + "/dependencies"), null).andExpect(status().isForbidden());

        // A task from another project can't be a blocker.
        String other = data(call(outsider, post("/api/projects"), Map.of("name", "Elsewhere " + SEQ.get(), "key", "EL" + (SEQ.get() % 1000), "startDate", LocalDate.now().toString())));
        long otherProject = ((Number) JsonPath.read(other, "$.data.id")).longValue();
        String otherTask = data(call(outsider, post("/api/projects/" + otherProject + "/tasks"), Map.of("title", "Foreign task", "priority", "LOW")));
        long foreign = ((Number) JsonPath.read(otherTask, "$.data.id")).longValue();
        depend(owner, c, foreign).andExpect(status().isBadRequest());

        Number depId = JsonPath.read(list, "$.data[0].id");
        call(viewer, delete("/api/dependencies/" + depId.longValue()), null).andExpect(status().isForbidden());
        call(owner, delete("/api/dependencies/" + depId.longValue()), null).andExpect(status().isOk());
    }

    // ---------------------------------------------------------------- planning

    @Test
    @DisplayName("Applying a plan: managers only, all-or-nothing, stale scenarios rejected")
    void applyPlan() throws Exception {
        long a = createTask(maya);
        long b = createTask(maya);
        long va = ((Number) JsonPath.read(data(call(owner, get("/api/tasks/" + a), null)), "$.data.version")).longValue();
        long vb = ((Number) JsonPath.read(data(call(owner, get("/api/tasks/" + b), null)), "$.data.version")).longValue();
        String due = LocalDate.now().plusDays(10).toString();
        Map<String, Object> basis = Map.of("tasks", List.of(Map.of("taskId", a, "version", va), Map.of("taskId", b, "version", vb)), "dependencyIds", List.of());
        Map<String, Object> plan = Map.of("basis", basis, "changes", List.of(
                Map.of("taskId", a, "version", va, "dueDate", due, "estimateDays", 3),
                Map.of("taskId", b, "version", vb, "assigneeId", nate.id())));

        call(maya, post("/api/projects/" + projectId + "/plan/apply"), plan).andExpect(status().isForbidden());

        // Someone edits task b after the scenario was calculated → nothing is applied.
        call(owner, put("/api/tasks/" + b), new HashMap<>(Map.of("title", "Edited meanwhile", "priority", "LOW", "assigneeId", maya.id(), "version", vb)))
                .andExpect(status().isOk());
        call(manager, post("/api/projects/" + projectId + "/plan/apply"), plan)
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("EDIT_CONFLICT"));
        call(owner, get("/api/tasks/" + a), null).andExpect(jsonPath("$.data.dueDate").doesNotExist());

        long vb2 = ((Number) JsonPath.read(data(call(owner, get("/api/tasks/" + b), null)), "$.data.version")).longValue();
        Map<String, Object> freshBasis = Map.of("tasks", List.of(Map.of("taskId", a, "version", va), Map.of("taskId", b, "version", vb2)), "dependencyIds", List.of());

        // A task that isn't being changed but was added after the scenario also makes it stale.
        Map<String, Object> missingNewTask = Map.of("basis", freshBasis, "changes", List.of(
                Map.of("taskId", a, "version", va, "dueDate", due, "estimateDays", 3),
                Map.of("taskId", b, "version", vb2, "assigneeId", nate.id())));
        long c = createTask(maya);
        call(manager, post("/api/projects/" + projectId + "/plan/apply"), missingNewTask)
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("EDIT_CONFLICT"));
        long vc = ((Number) JsonPath.read(data(call(owner, get("/api/tasks/" + c), null)), "$.data.version")).longValue();

        Map<String, Object> fresh = Map.of("basis", Map.of("tasks", List.of(Map.of("taskId", a, "version", va), Map.of("taskId", b, "version", vb2), Map.of("taskId", c, "version", vc)), "dependencyIds", List.of()),
                "changes", List.of(
                Map.of("taskId", a, "version", va, "dueDate", due, "estimateDays", 3),
                Map.of("taskId", b, "version", vb2, "assigneeId", nate.id())));
        call(manager, post("/api/projects/" + projectId + "/plan/apply"), fresh)
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.changedTasks").value(2));
        call(owner, get("/api/tasks/" + a), null).andExpect(jsonPath("$.data.dueDate").value(due)).andExpect(jsonPath("$.data.estimateDays").value(3));
        call(owner, get("/api/tasks/" + b), null).andExpect(jsonPath("$.data.assignee.id").value((int) nate.id()));
    }

    // --------------------------------------------------------------------- AI

    @Test
    @DisplayName("Without a provider, AI is honestly unavailable and access rules still apply")
    void aiUnavailable() throws Exception {
        call(maya, get("/api/ai/status"), null)
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.available").value(false)).andExpect(jsonPath("$.data.reason").isNotEmpty());
        long taskId = createTask(maya);
        call(maya, post("/api/tasks/" + taskId + "/ai/criteria"), null)
                .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.code").value("AI_UNAVAILABLE"));
        call(owner, post("/api/projects/" + projectId + "/ai/summary"), null)
                .andExpect(status().isServiceUnavailable());
        // "Ask about this project": the same honest state, for any member (viewers included).
        Map<String, Object> ask = Map.of("question", "Why is the estimated finish after the deadline?",
                "forecast", Map.of("finish", "2026-12-01", "tasks", List.of(Map.of("key", "NOPE-1", "start", "2026-11-01", "finish", "2026-11-03", "late", true))));
        call(owner, post("/api/projects/" + projectId + "/ai/ask"), ask)
                .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.code").value("AI_UNAVAILABLE"));
        call(owner, post("/api/projects/" + projectId + "/ai/ask"), Map.of("question", " ")).andExpect(status().isBadRequest());
        call(owner, post("/api/projects/" + projectId + "/ai/ask"), Map.of("question", "x".repeat(501))).andExpect(status().isBadRequest());
        // Streamed, the refusal is an ordinary error response: no stream is opened.
        call(owner, post("/api/projects/" + projectId + "/ai/ask/stream?requestId=q-1234567890"), ask)
                .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.code").value("AI_UNAVAILABLE"));
        call(outsider, post("/api/projects/" + projectId + "/ai/ask/stream"), ask).andExpect(status().isForbidden());
        // Stopping touches only the asker's own question; an outsider can't even try.
        call(owner, delete("/api/projects/" + projectId + "/ai/ask/q-1234567890"), null).andExpect(status().isNoContent());
        call(outsider, delete("/api/projects/" + projectId + "/ai/ask/q-1234567890"), null).andExpect(status().isForbidden());
        // Access is checked before availability: outsiders learn nothing.
        call(outsider, post("/api/projects/" + projectId + "/ai/ask"), ask).andExpect(status().isForbidden());
        call(outsider, post("/api/projects/" + projectId + "/ai/summary"), null).andExpect(status().isForbidden());
        call(nate, post("/api/tasks/" + taskId + "/ai/criteria"), null).andExpect(status().isForbidden());
    }

    // ------------------------------------------------------------ live updates

    @Test
    @DisplayName("Live updates: tickets need a session, streams need a valid one-time ticket")
    void liveTickets() throws Exception {
        call(null, post("/api/events/ticket"), null).andExpect(status().isUnauthorized());
        String res = data(call(maya, post("/api/events/ticket"), null).andExpect(status().isOk()));
        String ticket = JsonPath.read(res, "$.data.ticket");
        assertThat(ticket).hasSizeGreaterThan(20);
        mvc.perform(get("/api/events/stream").param("ticket", "not-a-ticket")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/events/stream").param("ticket", ticket)).andExpect(status().isOk());
        // One-time: the same ticket can't open a second stream.
        mvc.perform(get("/api/events/stream").param("ticket", ticket)).andExpect(status().isUnauthorized());
    }

    // ------------------------------------------------------- mentions and backlinks

    private List<String> notificationTypes(Account who) throws Exception {
        return JsonPath.read(data(call(who, get("/api/notifications?size=100"), null).andExpect(status().isOk())), "$.data.content[*].type");
    }

    private long mentionCount(Account who) throws Exception {
        String res = data(call(who, get("/api/notifications?category=MENTIONS"), null).andExpect(status().isOk()));
        return ((Number) JsonPath.read(res, "$.data.totalElements")).longValue();
    }

    private long taskWithDescription(Account who, long inProject, String description) throws Exception {
        String res = data(call(who, post("/api/projects/" + inProject + "/tasks"), Map.of("title", "Linked work", "priority", "LOW", "description", description))
                .andExpect(status().isCreated()));
        return ((Number) JsonPath.read(res, "$.data.id")).longValue();
    }

    @Test
    @DisplayName("@mentions tell project members once; nobody outside the project is told")
    void mentionsNotifyMembersOnly() throws Exception {
        long taskId = createTask(nate);
        String body = "@Nate Member can you check the copy? cc @Otto Outsider";
        String res = data(call(maya, post("/api/tasks/" + taskId + "/comments"), Map.of("body", body)).andExpect(status().isCreated()));
        long commentId = ((Number) JsonPath.read(res, "$.data.id")).longValue();
        // Nate (assignee, mentioned) gets one mention instead of a "new comment"; Otto isn't on the project.
        assertThat(mentionCount(nate)).isEqualTo(1);
        assertThat(notificationTypes(nate)).doesNotContain("COMMENT");
        assertThat(mentionCount(outsider)).isZero();
        // Editing tells only the people the edit newly mentions, and never the writer.
        call(maya, put("/api/comments/" + commentId), Map.of("body", body + " and @Mark Manager, @Maya Member")).andExpect(status().isOk());
        assertThat(mentionCount(nate)).isEqualTo(1);
        assertThat(mentionCount(manager)).isEqualTo(1);
        assertThat(mentionCount(maya)).isZero();
        // A mention in a description counts too; one inside code doesn't.
        taskWithDescription(owner, projectId, "Pair with @Vera Viewer on this. Not `@Mark Manager` though.");
        assertThat(mentionCount(viewer)).isEqualTo(1);
        assertThat(mentionCount(manager)).isEqualTo(1);
    }

    @Test
    @DisplayName("Backlinks list where a task is named, only from projects the reader belongs to")
    void backlinksRespectAccess() throws Exception {
        long target = createTask(maya);
        String key = JsonPath.read(data(call(owner, get("/api/tasks/" + target), null)), "$.data.key");
        long inDescription = taskWithDescription(owner, projectId, "Blocked until " + key + " ships.");
        taskWithDescription(owner, projectId, "Not this one: " + key + "0 and `" + key + "`.");
        long commented = createTask(nate);
        call(nate, post("/api/tasks/" + commented + "/comments"), Map.of("body", "Same root cause as " + key + "?")).andExpect(status().isCreated());

        // Otto names the key in his own project; the people on this project can't see that.
        int n = SEQ.incrementAndGet();
        String other = data(call(outsider, post("/api/projects"), Map.of("name", "Elsewhere " + n, "key", "EL" + (n % 1000), "startDate", LocalDate.now().toString()))
                .andExpect(status().isCreated()));
        long otherProject = ((Number) JsonPath.read(other, "$.data.id")).longValue();
        long hidden = taskWithDescription(outsider, otherProject, "Copying " + key + " from the other team.");

        String res = data(call(viewer, get("/api/tasks/" + target + "/mentions"), null).andExpect(status().isOk()));
        List<Number> ids = JsonPath.read(res, "$.data[*].taskId");
        assertThat(ids.stream().map(Number::longValue).toList()).containsExactlyInAnyOrder(inDescription, commented);
        assertThat(ids.stream().map(Number::longValue).toList()).doesNotContain(hidden, target);
        List<String> sources = JsonPath.read(res, "$.data[*].source");
        assertThat(sources).containsExactlyInAnyOrder("DESCRIPTION", "COMMENT");
        call(outsider, get("/api/tasks/" + target + "/mentions"), null).andExpect(status().isForbidden());
    }

    // --------------------------------------------------------------- catch-up

    @Test
    @DisplayName("Since you were last here: others' changes in your projects only, counted from the records")
    void catchUp() throws Exception {
        String first = data(call(maya, get("/api/catch-up"), null).andExpect(status().isOk()));
        assertThat((Object) JsonPath.read(first, "$.data.since")).isNull();
        call(maya, post("/api/catch-up/seen"), null).andExpect(status().isOk());

        long taskId = createTask(nate); // the owner creates it: one TASK_CREATED, one TASK_ASSIGNED
        call(nate, post("/api/tasks/" + taskId + "/comments"), Map.of("body", "On it.")).andExpect(status().isCreated());
        call(maya, post("/api/tasks/" + taskId + "/comments"), Map.of("body", "My own words don't count.")).andExpect(status().isCreated());

        String res = data(call(maya, get("/api/catch-up"), null).andExpect(status().isOk()));
        assertThat((Object) JsonPath.read(res, "$.data.since")).isNotNull();
        assertThat(((Number) JsonPath.read(res, "$.data.counts.COMMENT_ADDED")).intValue()).isEqualTo(1);
        assertThat(((Number) JsonPath.read(res, "$.data.counts.TASK_CREATED")).intValue()).isEqualTo(1);
        List<Number> actors = JsonPath.read(res, "$.data.latest[*].actor.id");
        assertThat(actors.stream().map(Number::longValue).toList()).doesNotContain(maya.id()).isNotEmpty();

        // Someone outside the project hears nothing about it.
        call(outsider, post("/api/catch-up/seen"), null).andExpect(status().isOk());
        String other = data(call(outsider, get("/api/catch-up"), null).andExpect(status().isOk()));
        assertThat((Map<?, ?>) JsonPath.read(other, "$.data.counts")).isEmpty();
    }

    // ------------------------------------------------------------- 3D replay

    @Test
    @DisplayName("History for the 3D replay: every status change in order, members only")
    void statusHistory() throws Exception {
        long taskId = createTask(maya);
        call(maya, patch("/api/tasks/" + taskId + "/status"), Map.of("status", "IN_PROGRESS")).andExpect(status().isOk());
        tickAll(maya, taskId);
        submit(maya, taskId, repoLink()).andExpect(status().isCreated());

        String res = data(call(viewer, get("/api/projects/" + projectId + "/history"), null).andExpect(status().isOk()));
        List<String> to = JsonPath.read(res, "$.data[?(@.taskId == " + taskId + ")].to");
        assertThat(to).containsExactly("TODO", "IN_PROGRESS", "IN_REVIEW");
        call(outsider, get("/api/projects/" + projectId + "/history"), null).andExpect(status().isForbidden());
    }

    // ------------------------------------------------------------- forecast training data

    @Test
    @DisplayName("Task history for training a forecast: owners and managers only, and it names no one")
    void taskHistoryExport() throws Exception {
        long taskId = createTask(maya);
        call(maya, patch("/api/tasks/" + taskId + "/status"), Map.of("status", "IN_PROGRESS")).andExpect(status().isOk());
        tickAll(maya, taskId);
        submit(maya, taskId, repoLink()).andExpect(status().isCreated());

        String url = "/api/projects/" + projectId + "/export/task-history.csv";
        call(maya, get(url), null).andExpect(status().isForbidden());
        call(viewer, get(url), null).andExpect(status().isForbidden());
        call(outsider, get(url), null).andExpect(status().isForbidden());
        ResultActions ok = call(manager, get(url), null).andExpect(status().isOk());
        String csv = data(ok);
        assertThat(ok.andReturn().getResponse().getContentType()).startsWith("text/csv");
        assertThat(ok.andReturn().getResponse().getHeader("Content-Disposition")).contains("task-history-v1.csv");
        List<String> lines = csv.lines().toList();
        assertThat(lines.get(0)).isEqualTo(String.join(",", dev.projectflow.service.TaskHistoryExport.COLUMNS));
        assertThat(lines).anyMatch(l -> l.contains(",IN_REVIEW,") && l.contains(",p1,"));
        assertThat(csv).doesNotContain("Maya", "@test.dev");
    }
}
