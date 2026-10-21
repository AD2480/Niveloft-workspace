package dev.projectflow.forecast;

import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * One row of a project's task history (version 1, the file owners and managers download for the
 * {@code ml/} kit), read the way the kit reads it: empty cells are missing, counts default to 0,
 * and a person is named per project ({@code ONB:p1}), as the kit keeps two projects' p1 apart.
 */
public record HistoryRow(
        String project,
        String task,
        String status,
        String priority,
        Double estimateDays,
        String person,
        Instant createdAt,
        Instant startedAt,
        Instant blockersApprovedAt,
        Instant lastReviewAt,
        Instant approvedAt,
        LocalDate dueDate,
        int waitsOn,
        int holdsUp,
        int criteria,
        int checklist,
        int descriptionChars) {

    static final List<String> COLUMNS = List.of(
            "project", "task", "status", "priority", "estimate_days", "person",
            "created_at", "started_at", "blockers_approved_at", "last_review_at", "approved_at", "due_date",
            "waits_on", "holds_up", "criteria", "checklist", "description_chars", "submissions", "changes_requested");

    /** Reads the file's text. A row that can't be read is an error: this file is written by the server itself. */
    public static List<HistoryRow> parse(String csv) {
        List<List<String>> lines = cells(csv);
        if (lines.isEmpty()) return List.of();
        Map<String, Integer> col = new HashMap<>();
        List<String> header = lines.get(0);
        for (int i = 0; i < header.size(); i++) col.put(header.get(i).strip(), i);
        for (String c : COLUMNS) if (!col.containsKey(c)) throw new IllegalArgumentException("not a task history (version 1): no " + c + " column");
        List<HistoryRow> out = new ArrayList<>();
        for (List<String> cells : lines.subList(1, lines.size())) {
            if (cells.size() == 1 && cells.get(0).isBlank()) continue;
            java.util.function.Function<String, String> v = name -> {
                int i = col.get(name);
                String s = i < cells.size() ? cells.get(i).strip() : "";
                return s.isEmpty() ? null : s;
            };
            String project = v.apply("project");
            String person = v.apply("person");
            out.add(new HistoryRow(
                    project,
                    v.apply("task"),
                    v.apply("status"),
                    v.apply("priority"),
                    number(v.apply("estimate_days")),
                    person == null ? null : project + ":" + person,
                    instant(v.apply("created_at")),
                    instant(v.apply("started_at")),
                    instant(v.apply("blockers_approved_at")),
                    instant(v.apply("last_review_at")),
                    instant(v.apply("approved_at")),
                    date(v.apply("due_date")),
                    count(v.apply("waits_on")),
                    count(v.apply("holds_up")),
                    count(v.apply("criteria")),
                    count(v.apply("checklist")),
                    count(v.apply("description_chars"))));
        }
        return out;
    }

    private static Double number(String s) {
        if (s == null) return null;
        try {
            double d = Double.parseDouble(s);
            return Double.isFinite(d) ? d : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static int count(String s) {
        Double d = number(s);
        return d == null ? 0 : (int) Math.round(d);
    }

    private static Instant instant(String s) {
        if (s == null) return null;
        try {
            return Instant.parse(s);
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    private static LocalDate date(String s) {
        if (s == null) return null;
        try {
            return LocalDate.parse(s.length() > 10 ? s.substring(0, 10) : s);
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    /** CSV cells (RFC 4180: quotes, doubled quotes, line breaks in quotes). */
    static List<List<String>> cells(String text) {
        List<List<String>> rows = new ArrayList<>();
        List<String> row = new ArrayList<>();
        StringBuilder cell = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (quoted) {
                if (c == '"') {
                    if (i + 1 < text.length() && text.charAt(i + 1) == '"') {
                        cell.append('"');
                        i++;
                    } else {
                        quoted = false;
                    }
                } else {
                    cell.append(c);
                }
            } else if (c == '"') {
                quoted = true;
            } else if (c == ',') {
                row.add(cell.toString());
                cell.setLength(0);
            } else if (c == '\n' || c == '\r') {
                if (c == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') i++;
                row.add(cell.toString());
                cell.setLength(0);
                rows.add(row);
                row = new ArrayList<>();
            } else {
                cell.append(c);
            }
        }
        if (cell.length() > 0 || !row.isEmpty()) {
            row.add(cell.toString());
            rows.add(row);
        }
        return rows;
    }
}
