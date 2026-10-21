package dev.projectflow.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.projectflow.domain.*;
import dev.projectflow.repository.ActivityRepository;
import dev.projectflow.repository.CommentRepository;
import dev.projectflow.repository.ReviewRepository;
import dev.projectflow.repository.SubmissionRepository;
import dev.projectflow.repository.TaskDependencyRepository;
import dev.projectflow.repository.TaskRepository;
import dev.projectflow.service.DtoMapper;
import dev.projectflow.service.TextRefs;
import dev.projectflow.web.dto.Dto;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * What Flurry's tools do: read one project's records, the ones every member of it may already
 * see, and turn them into text for the model, with what people wrote inside {@code <record>} tags
 * (escaped) so it reads as data, never as instructions. Each lookup runs in its own short
 * read-only transaction. Proposal tools change nothing: they add a validated suggestion for the
 * person to review, the same as the proposals in a written answer.
 *
 * <p>The tools are described in {@code resources/ai/tools.json}.
 */
@Component
public class ProjectTools {

    private static final Logger log = LoggerFactory.getLogger(ProjectTools.class);
    private static final Pattern KEY = Pattern.compile("^([A-Z][A-Z0-9]{1,9})-(\\d{1,6})$");
    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
    static final int MAX_LIST = 15;
    static final int MAX_COMMENTS = 30;
    static final int MAX_ACTIVITY = 40;
    static final int MAX_PASSAGES = 5;

    /** The project a question is about, and the task keys that exist in it (for validating proposals). */
    public record Scope(Long projectId, String projectKey, Set<String> keys) {}

    private final TaskRepository tasks;
    private final TaskDependencyRepository dependencies;
    private final CommentRepository comments;
    private final SubmissionRepository submissions;
    private final ReviewRepository reviews;
    private final ActivityRepository activities;
    private final dev.projectflow.service.DocumentSearch documents;
    private final ObjectMapper json;
    private final Clock clock;
    private final TransactionTemplate readOnly;

    public ProjectTools(TaskRepository tasks, TaskDependencyRepository dependencies, CommentRepository comments, SubmissionRepository submissions,
                        ReviewRepository reviews, ActivityRepository activities, dev.projectflow.service.DocumentSearch documents, ObjectMapper json, Clock clock,
                        PlatformTransactionManager txManager) {
        this.documents = documents;
        this.tasks = tasks;
        this.dependencies = dependencies;
        this.comments = comments;
        this.submissions = submissions;
        this.reviews = reviews;
        this.activities = activities;
        this.json = json;
        this.clock = clock;
        this.readOnly = new TransactionTemplate(txManager);
        this.readOnly.setReadOnly(true);
    }

    /** Runs one tool call for the project in scope. Proposals are added to {@code proposals} (at most 3). */
    public ToolLoop.Ran run(Scope scope, ToolChat.Call call, List<Dto.AiProposal> proposals) {
        JsonNode args = call.arguments() != null && call.arguments().isObject() ? call.arguments() : json.createObjectNode();
        String name = call.name() == null ? "" : call.name();
        try {
            ToolLoop.Ran ran = readOnly.execute(status -> switch (name) {
                case "find_tasks" -> findTasks(scope, args);
                case "get_task" -> getTask(scope, text(args, "key"));
                case "get_comments" -> getComments(scope, text(args, "key"));
                case "find_mentions" -> findMentions(scope, text(args, "key"));
                case "recent_activity" -> recentActivity(scope, args);
                case "search_documents" -> searchDocuments(scope, text(args, "query"));
                case "propose_create_task" -> proposeCreate(scope, args, proposals);
                case "propose_start_task" -> proposeStart(scope, text(args, "key"), proposals);
                default -> new ToolLoop.Ran("There is no tool called “" + AiService.clip(name, 60) + "”. Use only the tools listed.", "Asked for a tool that doesn’t exist", ToolLoop.Result.UNAVAILABLE);
            });
            return Objects.requireNonNull(ran);
        } catch (RuntimeException e) {
            log.warn("A Flurry lookup ({}) failed: {}", call.name(), e.toString());
            return new ToolLoop.Ran("The lookup failed, so this isn’t known. Say the records couldn’t be read; don’t guess.", "A lookup couldn’t be done, so that part isn’t known", ToolLoop.Result.UNAVAILABLE);
        }
    }

    // ------------------------------------------------------------------ the tools

    private ToolLoop.Ran findTasks(Scope scope, JsonNode args) {
        String query = text(args, "query");
        String status = text(args, "status").toUpperCase(Locale.ROOT);
        String assignee = text(args, "assignee").toLowerCase(Locale.ROOT);
        boolean overdue = args.path("overdue").asBoolean(false);
        LocalDate today = LocalDate.now(clock);
        List<String> words = Arrays.stream(query.toLowerCase(Locale.ROOT).split("\\s+")).filter(w -> w.length() > 1).toList();
        List<Task> all = new ArrayList<>(tasks.findByProjectId(scope.projectId()));
        all.sort(Comparator.comparingInt(Task::getNumber));
        List<Task> filtered = all.stream()
                .filter(t -> status.isEmpty() || t.getStatus().name().equals(status))
                .filter(t -> assignee.isEmpty() || (assignee.equals("unassigned") ? t.getAssignee() == null
                        : t.getAssignee() != null && t.getAssignee().getName().toLowerCase(Locale.ROOT).contains(assignee)))
                .filter(t -> !overdue || (t.getStatus() != TaskStatus.DONE && t.getDueDate() != null && t.getDueDate().isBefore(today)))
                .toList();
        List<Task> matched = words.isEmpty() ? filtered : filtered.stream().filter(t -> words.stream().allMatch(w -> haystack(t).contains(w))).toList();
        boolean partial = false;
        if (matched.isEmpty() && words.size() > 1) {
            // No task has every word: show the ones with some of them, and say so.
            matched = filtered.stream().filter(t -> words.stream().anyMatch(w -> haystack(t).contains(w))).toList();
            partial = !matched.isEmpty();
        }
        StringBuilder out = new StringBuilder();
        if (matched.isEmpty()) {
            out.append("No task in this project matches. That only means none matches these words and filters; it isn't evidence that the work doesn't exist.");
        } else {
            if (partial) out.append("No task has all of these words; these have some of them.\n");
            out.append(matched.size()).append(matched.size() == 1 ? " task" : " tasks").append(matched.size() > MAX_LIST ? " (the first " + MAX_LIST + " listed)" : "")
                    .append(" (key | title | status | owner | due):\n");
            matched.stream().limit(MAX_LIST).forEach(t -> out.append("- ").append(line(t, today)).append('\n'));
        }
        List<String> how = new ArrayList<>();
        if (!status.isEmpty()) how.add(statusWord(status));
        if (!assignee.isEmpty()) how.add(assignee.equals("unassigned") ? "with no owner" : "owned by " + text(args, "assignee"));
        if (overdue) how.add("late");
        String label = (query.isBlank() ? "Listed tasks" : "Searched tasks for “" + shorten(query, 40) + "”") + (how.isEmpty() ? "" : " (" + String.join(", ", how) + ")");
        List<Dto.AiRef> refs = matched.stream().limit(MAX_LIST).map(ProjectTools::taskRef).toList();
        return new ToolLoop.Ran(out.toString(), label, !matched.isEmpty(), refs);
    }

    private ToolLoop.Ran getTask(Scope scope, String key) {
        Optional<Task> found = task(scope, key);
        if (found.isEmpty()) return notFound(scope, key);
        Task t = found.get();
        String k = DtoMapper.taskKey(t);
        LocalDate today = LocalDate.now(clock);
        List<Dto.AiRef> refs = new ArrayList<>();
        refs.add(taskRef(t));
        StringBuilder out = new StringBuilder();
        out.append(k).append(" | <record>").append(AiService.clip(t.getTitle())).append("</record>\n");
        out.append("Status ").append(t.getStatus()).append(", priority ").append(t.getPriority())
                .append(", owner ").append(t.getAssignee() == null ? "nobody" : "<record>" + AiService.clip(t.getAssignee().getName()) + "</record>")
                .append(", created by <record>").append(AiService.clip(t.getReporter().getName())).append("</record>.\n");
        out.append(t.getDueDate() == null ? "No due date." : "Due " + t.getDueDate() + (t.getStatus() != TaskStatus.DONE && t.getDueDate().isBefore(today)
                ? " (" + ChronoUnit.DAYS.between(t.getDueDate(), today) + " days late)." : "."));
        out.append(t.getEstimateDays() == null ? " No estimate." : " Estimate " + t.getEstimateDays() + " working days.");
        out.append(t.getMilestone() == null ? " No milestone.\n" : " Milestone <record>" + AiService.clip(t.getMilestone().getName()) + "</record>.\n");
        out.append("Created ").append(day(t.getCreatedAt())).append(t.getStartedAt() == null ? ", not started" : ", started " + day(t.getStartedAt()))
                .append(t.getCompletedAt() == null ? ", not approved yet.\n" : ", approved " + day(t.getCompletedAt()) + ".\n");
        out.append("Description: ").append(t.getDescription() == null || t.getDescription().isBlank() ? "none.\n" : "<record>" + AiService.clip(t.getDescription(), 2000) + "</record>\n");

        List<AcceptanceCriterion> criteria = t.getCriteria().stream().sorted(Comparator.comparingInt(AcceptanceCriterion::getPosition)).toList();
        out.append(criteria.isEmpty() ? "Acceptance criteria: none written.\n" : "Acceptance criteria:\n");
        criteria.forEach(c -> out.append("- <record>").append(AiService.clip(c.getContent(), 300)).append("</record>\n"));
        List<ChecklistItem> checklist = t.getChecklist().stream().sorted(Comparator.comparingInt(ChecklistItem::getPosition)).toList();
        if (checklist.isEmpty()) out.append("Checklist: none.\n");
        else {
            out.append("Checklist: ").append(checklist.stream().filter(ChecklistItem::isDone).count()).append(" of ").append(checklist.size()).append(" done\n");
            checklist.forEach(c -> out.append("- [").append(c.isDone() ? "x" : " ").append("] <record>").append(AiService.clip(c.getContent(), 300)).append("</record>\n"));
        }

        List<TaskDependency> deps = dependencies.findByProjectId(scope.projectId());
        List<String> waitsOn = deps.stream().filter(d -> d.getBlocked().getId().equals(t.getId())).map(d -> DtoMapper.taskKey(d.getBlocker()) + " (" + d.getBlocker().getStatus() + ")").toList();
        List<String> holdsUp = deps.stream().filter(d -> d.getBlocker().getId().equals(t.getId())).map(d -> DtoMapper.taskKey(d.getBlocked()) + " (" + d.getBlocked().getStatus() + ")").toList();
        out.append("Waits on: ").append(waitsOn.isEmpty() ? "nothing" : String.join(", ", waitsOn)).append(".\n");
        out.append("Holds up: ").append(holdsUp.isEmpty() ? "nothing" : String.join(", ", holdsUp)).append(".\n");

        List<Submission> subs = submissions.findByTaskIdOrderByNumberDesc(t.getId());
        if (subs.isEmpty()) out.append("Submissions: none yet.\n");
        else {
            Map<Long, Review> byId = new HashMap<>();
            reviews.findBySubmissionIdIn(subs.stream().map(Submission::getId).toList()).forEach(r -> byId.put(r.getSubmission().getId(), r));
            out.append("Submissions, newest first:\n");
            for (Submission s : subs) {
                refs.add(Dto.AiRef.on("submission", k, t.getId(), s.getId(), "Version " + s.getNumber() + " submitted " + day(s.getCreatedAt())));
                out.append("- Version ").append(s.getNumber()).append(" by <record>").append(AiService.clip(s.getSubmittedBy().getName())).append("</record> on ").append(day(s.getCreatedAt()))
                        .append(", ").append(s.getStatus()).append(". Notes: <record>").append(AiService.clip(s.getNotes(), 600)).append("</record>");
                if (!s.getEvidence().isEmpty()) {
                    out.append(" Evidence (names only; links and files were not opened): ");
                    out.append(String.join("; ", s.getEvidence().stream().map(e -> e.getKind() + " <record>" + AiService.clip(e.getLabel() == null ? "" : e.getLabel(), 80) + "</record>").toList()));
                    out.append('.');
                }
                Review r = byId.get(s.getId());
                if (r != null) {
                    refs.add(Dto.AiRef.on("review", k, t.getId(), r.getId(),
                            (r.getDecision() == ReviewDecision.APPROVED ? "Approval" : "Changes requested") + " on version " + s.getNumber() + ", by " + shorten(r.getReviewer().getName(), 40)));
                    out.append(" Review by <record>").append(AiService.clip(r.getReviewer().getName())).append("</record>: ").append(r.getDecision());
                    if (r.getFeedback() != null && !r.getFeedback().isBlank()) out.append(". Feedback: <record>").append(AiService.clip(r.getFeedback(), 600)).append("</record>");
                    out.append('.');
                }
                out.append('\n');
            }
        }

        List<Comment> all = comments.findByTaskIdOrderByCreatedAtAscIdAsc(t.getId());
        if (all.isEmpty()) out.append("Comments: none.\n");
        else {
            out.append("Comments: ").append(all.size()).append(all.size() > 5 ? " (the latest 5, oldest first; get_comments has them all)" : "").append('\n');
            all.subList(Math.max(0, all.size() - 5), all.size()).forEach(c -> {
                out.append(comment(c, 500));
                refs.add(commentRef(k, c));
            });
        }
        return new ToolLoop.Ran(out.toString(), "Read " + k, true, refs);
    }

    private ToolLoop.Ran getComments(Scope scope, String key) {
        Optional<Task> found = task(scope, key);
        if (found.isEmpty()) return notFound(scope, key);
        Task t = found.get();
        String k = DtoMapper.taskKey(t);
        List<Comment> all = comments.findByTaskIdOrderByCreatedAtAscIdAsc(t.getId());
        if (all.isEmpty()) return new ToolLoop.Ran(k + " has no comments.", "Read the comments on " + k + " (none)", false);
        StringBuilder out = new StringBuilder(k).append(" has ").append(all.size()).append(all.size() == 1 ? " comment" : " comments")
                .append(all.size() > MAX_COMMENTS ? " (the latest " + MAX_COMMENTS + " listed)" : "").append(", oldest first:\n");
        List<Dto.AiRef> refs = new ArrayList<>();
        all.subList(Math.max(0, all.size() - MAX_COMMENTS), all.size()).forEach(c -> {
            out.append(comment(c, 800));
            refs.add(commentRef(k, c));
        });
        return new ToolLoop.Ran(out.toString(), "Read the comments on " + k, true, refs);
    }

    private ToolLoop.Ran findMentions(Scope scope, String key) {
        Optional<Task> found = task(scope, key);
        if (found.isEmpty()) return notFound(scope, key);
        Task t = found.get();
        String k = DtoMapper.taskKey(t);
        String like = "%" + k + "%";
        List<Long> here = List.of(scope.projectId());
        StringBuilder out = new StringBuilder();
        List<Dto.AiRef> refs = new ArrayList<>();
        int n = 0;
        for (Task other : tasks.findDescriptionMentioning(here, like)) {
            if (other.getId().equals(t.getId()) || !TextRefs.namesKey(other.getDescription(), k)) continue;
            n++;
            refs.add(Dto.AiRef.task(DtoMapper.taskKey(other), other.getId(), "The description of " + DtoMapper.taskKey(other)));
            out.append("- The description of ").append(DtoMapper.taskKey(other)).append(": <record>").append(AiService.clip(TextRefs.excerpt(other.getDescription(), k, 200))).append("</record>\n");
        }
        for (Comment c : comments.findMentioning(here, like, PageRequest.of(0, 50))) {
            if (c.getTask().getId().equals(t.getId()) || !TextRefs.namesKey(c.getBody(), k)) continue;
            n++;
            refs.add(commentRef(DtoMapper.taskKey(c.getTask()), c));
            out.append("- A comment by <record>").append(AiService.clip(c.getAuthor().getName())).append("</record> on ").append(DtoMapper.taskKey(c.getTask())).append(" (")
                    .append(when(c.getCreatedAt())).append("): <record>").append(AiService.clip(TextRefs.excerpt(c.getBody(), k, 200))).append("</record>\n");
        }
        if (n == 0) return new ToolLoop.Ran("Nothing else in this project names " + k + ".", "Looked for mentions of " + k + " (none)", false);
        return new ToolLoop.Ran(k + " is named in " + n + (n == 1 ? " place" : " places") + ":\n" + out, "Looked for mentions of " + k, true, refs);
    }

    private ToolLoop.Ran recentActivity(Scope scope, JsonNode args) {
        int days = Math.min(30, Math.max(1, args.path("days").asInt(7)));
        String key = text(args, "key");
        Long only = null;
        if (!key.isEmpty()) {
            Optional<Task> found = task(scope, key);
            if (found.isEmpty()) return notFound(scope, key);
            only = found.get().getId();
        }
        Instant since = Instant.now(clock).minus(Duration.ofDays(days));
        Long onlyId = only;
        List<Activity> recent = activities.findByProjectIdOrderByCreatedAtDescIdDesc(scope.projectId(), PageRequest.of(0, 200)).getContent().stream()
                .filter(a -> a.getCreatedAt().isAfter(since))
                .filter(a -> onlyId == null || onlyId.equals(a.getTaskId()))
                .limit(MAX_ACTIVITY)
                .toList();
        String what = (key.isEmpty() ? "" : key.toUpperCase(Locale.ROOT) + ": ") + "the last " + (days == 1 ? "day" : days + " days");
        if (recent.isEmpty()) return new ToolLoop.Ran("Nothing was recorded in " + what + ".", "Read " + what + " of activity (nothing recorded)", false);
        StringBuilder out = new StringBuilder("Recorded in ").append(what).append(", newest first (when | who | what):\n");
        Map<Long, Task> byId = new HashMap<>();
        tasks.findByProjectId(scope.projectId()).forEach(x -> byId.put(x.getId(), x));
        Map<Long, Dto.AiRef> touched = new LinkedHashMap<>();
        for (Activity a : recent) {
            Task x = a.getTaskId() == null ? null : byId.get(a.getTaskId());
            if (x != null) touched.putIfAbsent(x.getId(), taskRef(x));
            out.append("- ").append(when(a.getCreatedAt())).append(" | <record>").append(AiService.clip(a.getActor().getName())).append("</record> | <record>")
                    .append(AiService.clip(a.getMessage(), 200)).append("</record>");
            if (a.getFieldName() != null) {
                out.append(" | ").append(a.getFieldName()).append(": <record>").append(AiService.clip(Objects.toString(a.getOldValue(), "none"), 80)).append("</record> to <record>")
                        .append(AiService.clip(Objects.toString(a.getNewValue(), "none"), 80)).append("</record>");
            }
            out.append('\n');
        }
        return new ToolLoop.Ran(out.toString(), "Read " + what + " of activity", true, new ArrayList<>(touched.values()));
    }

    /** Passages of the project's approved documents about the query (drafts are never searched). */
    private ToolLoop.Ran searchDocuments(Scope scope, String query) {
        String label = "Searched the approved documents for “" + shorten(query, 40) + "”";
        if (documents == null) return new ToolLoop.Ran("Documents can't be searched here, so what they say isn't known. Don't guess.", label + " (not available)", ToolLoop.Result.UNAVAILABLE);
        if (query.isBlank()) return new ToolLoop.Ran("Give words to look for in the documents.", label, false);
        List<dev.projectflow.service.DocumentSearch.Hit> hits = documents.search(scope.projectId(), query, MAX_PASSAGES);
        if (hits.isEmpty()) {
            return new ToolLoop.Ran("No passage in this project's approved documents contains these words. That only means the approved documents don't mention them in these words; drafts aren't searched, and it isn't evidence about the question.",
                    label + " (nothing found)", false);
        }
        StringBuilder out = new StringBuilder(hits.size() + (hits.size() == 1 ? " passage" : " passages") + " from approved documents, best match first (document | section | passage):\n");
        List<Dto.AiRef> refs = new ArrayList<>();
        for (dev.projectflow.service.DocumentSearch.Hit h : hits) {
            String where = h.heading() == null ? "(no section)" : "<record>" + AiService.clip(h.heading(), 200) + "</record>";
            out.append("- <record>").append(AiService.clip(h.title(), 160)).append("</record> | ").append(where).append(" | p").append(h.passageId()).append(":\n  <record>")
                    .append(AiService.clip(h.content(), 900)).append("</record>\n");
            refs.add(new Dto.AiRef("document", null, null, h.passageId(), shorten(h.title(), 60) + (h.heading() == null ? "" : " › " + shorten(h.heading(), 60)), h.documentId()));
        }
        out.append("Quote or cite the document and section you use. A document says what was written when it was approved; it doesn't show what happened since.");
        return new ToolLoop.Ran(out.toString(), label, true, refs);
    }

    private ToolLoop.Ran proposeCreate(Scope scope, JsonNode args, List<Dto.AiProposal> proposals) {
        // Only the fields the tool declares, and the type last, so stray arguments can't turn it into another kind of suggestion.
        ObjectNode p = json.createObjectNode();
        for (String field : List.of("title", "description", "priority", "dueDate", "assigneeName", "estimateDays")) {
            if (args != null && args.hasNonNull(field)) p.set(field, args.get(field));
        }
        p.put("type", "CREATE_TASK");
        return propose(scope, p, proposals, "a new task “" + shorten(text(args, "title"), 50) + "”");
    }

    private ToolLoop.Ran proposeStart(Scope scope, String key, List<Dto.AiProposal> proposals) {
        ObjectNode p = json.createObjectNode().put("type", "START_TASK").put("taskKey", key);
        return propose(scope, p, proposals, "starting " + key.toUpperCase(Locale.ROOT));
    }

    /** Validates a suggestion the same way as the ones in a written answer; nothing is changed either way. */
    private ToolLoop.Ran propose(Scope scope, ObjectNode proposal, List<Dto.AiProposal> proposals, String what) {
        ArrayNode one = json.createArrayNode().add(proposal);
        List<Dto.AiProposal> valid = AiService.proposals(one, scope.keys());
        if (valid.isEmpty()) return new ToolLoop.Ran("Not a usable suggestion (a task needs a title; a task to start must exist in this project). Nothing was suggested.", "Couldn’t suggest " + what, ToolLoop.Result.DECLINED);
        if (proposals.size() >= 3) return new ToolLoop.Ran("Not added: three suggestions is the limit. Nothing has changed.", "Didn’t suggest " + what + " (limit of three)", ToolLoop.Result.DECLINED);
        proposals.add(valid.get(0));
        return new ToolLoop.Ran("Noted as a suggestion for the person to review. Nothing has changed; never say it has been done.", "Suggested " + what, true);
    }

    // ------------------------------------------------------------------ helpers

    private static Dto.AiRef taskRef(Task t) {
        return Dto.AiRef.task(DtoMapper.taskKey(t), t.getId(), shorten(t.getTitle(), 70));
    }

    private Dto.AiRef commentRef(String key, Comment c) {
        return Dto.AiRef.on("comment", key, c.getTask().getId(), c.getId(), "Comment by " + shorten(c.getAuthor().getName(), 40) + ", " + when(c.getCreatedAt()));
    }

    private Optional<Task> task(Scope scope, String key) {
        Matcher m = KEY.matcher(key == null ? "" : key.trim().toUpperCase(Locale.ROOT));
        if (!m.matches() || !m.group(1).equals(scope.projectKey())) return Optional.empty();
        return tasks.findByProjectIdAndNumber(scope.projectId(), Integer.parseInt(m.group(2)));
    }

    private ToolLoop.Ran notFound(Scope scope, String key) {
        String k = key == null || key.isBlank() ? "(no key given)" : AiService.clip(key.trim(), 30);
        return new ToolLoop.Ran("There is no task " + k + " in this project (its keys start with " + scope.projectKey() + "-). Don't guess what it is.",
                "Looked for " + k + " (not in this project)", false);
    }

    private String line(Task t, LocalDate today) {
        boolean late = t.getStatus() != TaskStatus.DONE && t.getDueDate() != null && t.getDueDate().isBefore(today);
        return DtoMapper.taskKey(t) + " | <record>" + AiService.clip(t.getTitle(), 200) + "</record> | " + t.getStatus() + " | "
                + (t.getAssignee() == null ? "nobody" : "<record>" + AiService.clip(t.getAssignee().getName()) + "</record>") + " | "
                + (t.getDueDate() == null ? "no due date" : "due " + t.getDueDate() + (late ? " (late)" : ""));
    }

    private String comment(Comment c, int max) {
        return "- " + when(c.getCreatedAt()) + " <record>" + AiService.clip(c.getAuthor().getName()) + "</record>: <record>" + AiService.clip(c.getBody(), max) + "</record>\n";
    }

    private static String haystack(Task t) {
        return (t.getTitle() + " " + Objects.toString(t.getDescription(), "")).toLowerCase(Locale.ROOT);
    }

    private String day(Instant at) {
        return LocalDate.ofInstant(at, clock.getZone()).toString();
    }

    private String when(Instant at) {
        return WHEN.format(LocalDateTime.ofInstant(at, clock.getZone()));
    }

    static String text(JsonNode args, String field) {
        JsonNode v = args == null ? null : args.get(field);
        return v == null || v.isNull() ? "" : v.asText("").trim();
    }

    private static String shorten(String s, int max) {
        String t = s == null ? "" : s.trim();
        return t.length() > max ? t.substring(0, max - 1) + "…" : t;
    }

    private static String statusWord(String status) {
        return switch (status) {
            case "TODO" -> "to do";
            case "IN_PROGRESS" -> "in progress";
            case "IN_REVIEW" -> "in review";
            case "DONE" -> "approved";
            default -> status.toLowerCase(Locale.ROOT);
        };
    }
}
