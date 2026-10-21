package dev.projectflow.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.projectflow.domain.Role;
import dev.projectflow.security.ProjectAccess;
import dev.projectflow.service.Permissions;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import dev.projectflow.web.error.ApiException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Corrections to Flurry's answers, collected so failures that recur can be seen and fixed with
 * evidence: a better prompt, a missing tool, a different model, and only then perhaps fine-tuning.
 * Anyone who asked may say whether an answer was right and, if not, what kind of mistake it was and
 * what the right answer would have been. Owners and managers see the project's totals, the recent
 * corrections and the patterns (by kind, by model, with or without lookups), and can download the
 * wrong answers as draft eval cases. Kept 180 days.
 */
@Service
public class AiFeedbackService {

    private static final Logger log = LoggerFactory.getLogger(AiFeedbackService.class);

    /** The kinds of mistake a person can name; a fixed list, so they can be counted. */
    public static final Map<String, String> CATEGORIES = new LinkedHashMap<>();

    static {
        CATEGORIES.put("wrong-facts", "Said something the records contradict");
        CATEGORIES.put("missed-record", "Missed something that is in the records");
        CATEGORIES.put("unknown-as-no", "Treated missing information as a no");
        CATEGORIES.put("wrong-task", "Talked about the wrong task, person or project");
        CATEGORIES.put("overstepped", "Claimed or suggested something it may not do");
        CATEGORIES.put("unclear", "Hard to follow, or too long");
        CATEGORIES.put("slow", "Too slow");
        CATEGORIES.put("other", "Something else");
    }

    static final int RETENTION_DAYS = 180;

    private final JdbcTemplate jdbc;
    private final ProjectAccess access;
    private final ObjectMapper json;
    private final Clock clock;

    public AiFeedbackService(JdbcTemplate jdbc, ProjectAccess access, ObjectMapper json, Clock clock) {
        this.jdbc = jdbc;
        this.access = access;
        this.json = json;
        this.clock = clock;
    }

    static String cut(String s, int max) {
        if (s == null) return null;
        String t = s.replace("\u0000", "").strip();
        return t.length() <= max ? t : t.substring(0, max - 1) + "…";
    }

    /** Records one person's verdict on one answer. */
    public void record(Long projectId, Requests.AiFeedback req) {
        ProjectAccess.Access a = access.require(projectId);
        String verdict = req.verdict() == null ? "" : req.verdict().trim().toLowerCase(Locale.ROOT);
        if (!verdict.equals("right") && !verdict.equals("wrong")) throw ApiException.validation("verdict", "Say whether the answer was right or wrong.");
        List<String> categories = new ArrayList<>();
        for (String c : req.categories() == null ? List.<String>of() : req.categories()) {
            String k = c == null ? "" : c.trim().toLowerCase(Locale.ROOT);
            if (!CATEGORIES.containsKey(k)) throw ApiException.validation("categories", "Unknown kind of mistake.");
            if (!categories.contains(k)) categories.add(k);
        }
        if (verdict.equals("right") && (!categories.isEmpty() || (req.correction() != null && !req.correction().isBlank()))) {
            throw ApiException.validation("verdict", "A right answer has no mistakes to name.");
        }
        String lookups = req.lookups() == null ? null : cut(String.join(", ", req.lookups().stream().map(l -> cut(l, 60)).toList()), 500);
        jdbc.update("INSERT INTO ai_feedback (project_id, user_id, verdict, categories, correction, question, answer, model, lookups, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                projectId, a.userId(), verdict, categories.isEmpty() ? null : String.join(",", categories), cut(req.correction(), 2000), cut(req.question(), 500), cut(req.answer(), 4000),
                cut(req.model(), 100), lookups, Timestamp.from(Instant.now(clock)));
    }

    private ProjectAccess.Access manager(Long projectId) {
        ProjectAccess.Access a = access.require(projectId);
        if (!Permissions.atLeast(a.role(), Role.MANAGER)) throw ApiException.forbidden("Only the project’s owners and managers can see corrections to Flurry’s answers.");
        return a;
    }

    private record Row(long id, String verdict, String categories, String correction, String question, String answer, String model, String lookups, Instant at) {}

    /** The project's ratings since a moment, newest first; {@code onlyWrong} keeps the wrong answers only. */
    private List<Row> rows(Long projectId, Instant since, boolean onlyWrong) {
        String sql = "SELECT id, verdict, categories, correction, question, answer, model, lookups, created_at FROM ai_feedback WHERE project_id = ? AND created_at > ?"
                + (onlyWrong ? " AND verdict = ?" : "") + " ORDER BY created_at DESC, id DESC";
        Object[] args = onlyWrong ? new Object[] {projectId, Timestamp.from(since), "wrong"} : new Object[] {projectId, Timestamp.from(since)};
        return jdbc.query(sql, (rs, i) -> new Row(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8),
                rs.getTimestamp(9).toInstant()), args);
    }

    static List<String> categoriesOf(String s) {
        return s == null || s.isBlank() ? List.of() : Arrays.stream(s.split(",")).map(String::trim).filter(x -> !x.isEmpty()).toList();
    }

    /** True when the answer was written without looking anything up (from the summary only). */
    static boolean noLookups(String lookups) {
        return lookups == null || lookups.isBlank();
    }

    /** The project's corrections over the last {@code days} days (1–180): totals, patterns and the latest. */
    public Dto.AiFeedbackSummary summary(Long projectId, int days) {
        manager(projectId);
        int span = Math.max(1, Math.min(RETENTION_DAYS, days));
        Instant since = Instant.now(clock).minus(Duration.ofDays(span));
        List<Row> all = rows(projectId, since, false);
        long right = all.stream().filter(r -> r.verdict().equals("right")).count();
        List<Row> wrong = all.stream().filter(r -> r.verdict().equals("wrong")).toList();
        Map<String, Long> byCategory = new LinkedHashMap<>();
        CATEGORIES.keySet().forEach(k -> byCategory.put(k, 0L));
        wrong.forEach(r -> categoriesOf(r.categories()).forEach(c -> byCategory.merge(c, 1L, Long::sum)));
        byCategory.values().removeIf(v -> v == 0);
        Map<String, long[]> models = new TreeMap<>();
        for (Row r : all) {
            long[] n = models.computeIfAbsent(r.model() == null ? "unknown" : r.model(), k -> new long[2]);
            n[r.verdict().equals("right") ? 0 : 1]++;
        }
        long wrongWithout = wrong.stream().filter(r -> noLookups(r.lookups())).count();
        long allWithout = all.stream().filter(r -> noLookups(r.lookups())).count();
        List<Dto.AiFeedbackItem> latest = wrong.stream().limit(30)
                .map(r -> new Dto.AiFeedbackItem(r.id(), r.question(), cut(r.answer(), 600), categoriesOf(r.categories()), r.correction(), r.model(), r.lookups(), r.at())).toList();
        return new Dto.AiFeedbackSummary(since, span, all.size(), right, wrong.size(), byCategory,
                models.entrySet().stream().map(e -> new Dto.AiFeedbackModel(e.getKey(), e.getValue()[0], e.getValue()[1])).toList(),
                allWithout, wrongWithout, latest, CATEGORIES);
    }

    /**
     * The wrong answers as draft eval cases, one JSON object per line, in the shape of
     * ml/eval_cases/flurry-tools.jsonl (the question, the wrong answer to avoid, and the person's
     * correction as a note): a start for the team to edit, not cases to run as they are.
     */
    public String exportCases(Long projectId, int days) {
        manager(projectId);
        int span = Math.max(1, Math.min(RETENTION_DAYS, days));
        StringBuilder out = new StringBuilder();
        for (Row r : rows(projectId, Instant.now(clock).minus(Duration.ofDays(span)), true)) {
            ObjectNode c = json.createObjectNode();
            c.put("id", "feedback-" + r.id());
            c.put("category", "from-feedback");
            c.put("question", r.question());
            c.set("kinds", json.valueToTree(categoriesOf(r.categories())));
            c.put("wrong_answer", r.answer());
            if (r.correction() != null) c.put("correction", r.correction());
            if (r.model() != null) c.put("model", r.model());
            c.put("lookups", r.lookups() == null ? "" : r.lookups());
            c.set("answer_must", json.createArrayNode());
            ArrayNode mustNot = json.createArrayNode();
            c.set("answer_must_not", mustNot);
            c.put("note", "Draft from a person's correction on " + r.at().toString().substring(0, 10) + ". Write what a right answer must and mustn't say, and what it should look up, before adding it to the eval.");
            try {
                out.append(json.writeValueAsString(c)).append('\n');
            } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
                throw new IllegalStateException(e);
            }
        }
        return out.toString();
    }

    @Scheduled(cron = "0 53 3 * * *")
    public void purge() {
        try {
            int n = jdbc.update("DELETE FROM ai_feedback WHERE created_at < ?", Timestamp.from(Instant.now(clock).minus(Duration.ofDays(RETENTION_DAYS))));
            if (n > 0) log.info("Removed {} corrections to Flurry older than {} days", n, RETENTION_DAYS);
        } catch (RuntimeException e) {
            log.warn("Couldn't remove old corrections to Flurry: {}", e.getMessage());
        }
    }
}
