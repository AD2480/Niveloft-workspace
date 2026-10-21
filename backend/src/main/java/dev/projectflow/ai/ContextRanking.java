package dev.projectflow.ai;

import dev.projectflow.domain.TaskStatus;
import dev.projectflow.service.DocumentText;
import java.time.Instant;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Which tasks a question's context lists when a project has more than fit. Before, it was simply
 * the first ones by number, so a question about recent work in a big project could miss it. Now:
 * the tasks the question or the conversation names by key come first, then those whose titles
 * share the question's words, then open work (in review, in progress, overdue, holding other work
 * up, to do), then the most recently changed; listed in key order. With lookups on, Flurry can
 * still read any task that isn't listed, and the prompt says the list is partial.
 */
final class ContextRanking {

    private ContextRanking() {}

    /** A task as the ranking sees it. */
    record Task(Long id, int number, String key, String title, TaskStatus status, boolean overdue, boolean holdingUp, Instant changed) {}

    /** Words in questions that say little about which tasks are meant. */
    static final Set<String> GENERIC = Set.of("task", "tasks", "project", "projects", "work", "what", "which", "who", "when", "why", "where", "show", "list",
            "tell", "late", "status", "done", "open", "next", "need", "needs", "should", "about", "still", "any", "all", "me", "my", "our", "we", "you");

    static List<Task> pick(List<Task> all, String question, List<String> earlier, int max) {
        if (all.size() <= max) return all;
        String asked = question == null ? "" : question;
        String said = (asked + " " + String.join(" ", earlier == null ? List.of() : earlier)).toUpperCase(Locale.ROOT);
        List<String> words = DocumentText.queryWords(asked, 12).stream().filter(w -> !GENERIC.contains(w)).toList();
        Map<Long, Integer> score = new HashMap<>();
        for (Task t : all) score.put(t.id(), score(t, said, words));
        Comparator<Instant> newest = Comparator.nullsLast(Comparator.reverseOrder());
        return all.stream()
                .sorted(Comparator.<Task>comparingInt(t -> score.get(t.id())).reversed()
                        .thenComparing(Task::changed, newest)
                        .thenComparing(Comparator.comparingInt(Task::number).reversed()))
                .limit(max)
                .sorted(Comparator.comparingInt(Task::number))
                .toList();
    }

    static int score(Task t, String saidUpper, List<String> words) {
        int s = 0;
        if (t.key() != null && named(saidUpper, t.key())) s += 1000;
        List<String> title = DocumentText.words(t.title());
        for (String w : words) if (title.stream().anyMatch(x -> alike(x, w))) s += 40;
        s += switch (t.status()) {
            case IN_REVIEW -> 30;
            case IN_PROGRESS -> 25;
            case TODO -> 10;
            case DONE -> 0;
        };
        if (t.overdue()) s += 15;
        if (t.holdingUp()) s += 12;
        return s;
    }

    /** The key as a whole word: ONB-1 isn't named by ONB-12. */
    static boolean named(String textUpper, String key) {
        return Pattern.compile("(?<![A-Z0-9])" + Pattern.quote(key.toUpperCase(Locale.ROOT)) + "(?![0-9])").matcher(textUpper).find();
    }

    /** The same word, or one the other begins with (deploy, deployment), for words of four letters or more. */
    static boolean alike(String a, String b) {
        if (a.equals(b)) return true;
        return a.length() >= 4 && b.length() >= 4 && (a.startsWith(b) || b.startsWith(a));
    }
}
