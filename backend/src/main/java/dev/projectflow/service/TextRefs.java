package dev.projectflow.service;

import dev.projectflow.domain.User;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * What a piece of writing refers to: the people it @mentions and the task keys it names. The same
 * rules as the frontend's rich text (frontend/src/lib/richText.ts), so what's highlighted is what
 * notifies: a mention is "@" plus a person's full name, or a first name only one of them has, not
 * inside a word (an email address), not running on into another word, and never inside code.
 */
public final class TextRefs {

    private TextRefs() {}

    private static final Pattern FENCED = Pattern.compile("```[\\s\\S]*?(```|$)");
    private static final Pattern INLINE_CODE = Pattern.compile("`[^`\\n]+`");
    /** [label](target) links and bare web addresses: a key inside one is part of the link, not a reference. */
    private static final Pattern LINKS = Pattern.compile("\\[[^\\]\\n]*\\]\\([^)\\s]*\\)|(?:https?://|mailto:)[^\\s<>()\\[\\]]+");

    /** The text with its code (fenced blocks and `spans`) blanked out. */
    static String withoutCode(String text) {
        if (text == null) return "";
        String s = FENCED.matcher(text).replaceAll(m -> " ".repeat(m.group().length()));
        return INLINE_CODE.matcher(s).replaceAll(m -> " ".repeat(m.group().length()));
    }

    private record Alias(String text, User user) {}

    private static List<Alias> aliases(Collection<User> people) {
        List<Alias> out = new ArrayList<>();
        Map<String, List<User>> byFirst = new HashMap<>();
        for (User u : people) {
            if (u == null || u.getName() == null || u.getName().isBlank()) continue;
            String full = u.getName().trim();
            out.add(new Alias(full.toLowerCase(Locale.ROOT), u));
            String first = full.split("\\s+")[0].toLowerCase(Locale.ROOT);
            byFirst.computeIfAbsent(first, k -> new ArrayList<>()).add(u);
        }
        byFirst.forEach((first, users) -> {
            if (users.size() == 1 && !users.get(0).getName().trim().equalsIgnoreCase(first)) out.add(new Alias(first, users.get(0)));
        });
        out.sort(Comparator.comparingInt((Alias a) -> a.text().length()).reversed());
        return out;
    }

    /** The people mentioned in a text, once each, in the order they're first mentioned. */
    public static Set<User> mentions(String text, Collection<User> people) {
        Set<User> found = new LinkedHashSet<>();
        String s = withoutCode(text);
        String lower = s.toLowerCase(Locale.ROOT);
        List<Alias> aliases = aliases(people);
        for (int i = s.indexOf('@'); i >= 0; i = s.indexOf('@', i + 1)) {
            if (i > 0 && isEmailChar(s.charAt(i - 1))) continue;
            for (Alias a : aliases) {
                if (lower.startsWith(a.text(), i + 1)) {
                    int end = i + 1 + a.text().length();
                    if (end >= s.length() || !isWordChar(s.charAt(end))) {
                        found.add(a.user());
                        break;
                    }
                }
            }
        }
        return found;
    }

    /** Whether the text names a task key on its own (not inside a longer key, a word, a link or code). */
    public static boolean namesKey(String text, String key) {
        if (text == null || key == null || key.isBlank()) return false;
        String s = LINKS.matcher(withoutCode(text)).replaceAll(m -> " ".repeat(m.group().length()));
        return Pattern.compile("(?<![A-Za-z0-9_-])" + Pattern.quote(key) + "(?![A-Za-z0-9_-])").matcher(s).find();
    }

    /** A short plain excerpt of the text around the key (or its start), for a list of mentions. */
    public static String excerpt(String text, String key, int max) {
        String plain = (text == null ? "" : text)
                .replaceAll("```[\\s\\S]*?```", " ")
                .replaceAll("`([^`]+)`", "$1")
                .replaceAll("\\[([^\\]]+)\\]\\([^)]+\\)", "$1")
                .replaceAll("(\\*\\*|__)(.*?)\\1", "$2")
                .replaceAll("(?m)^\\s*(#{1,3}|>|[-*•])\\s+(\\[[ xX]\\]\\s+)?", "")
                .replaceAll("\\s+", " ")
                .trim();
        if (plain.length() <= max) return plain;
        int at = key == null ? -1 : plain.indexOf(key);
        int start = at < 0 ? 0 : Math.max(0, Math.min(at - max / 3, plain.length() - max));
        String cut = plain.substring(start, Math.min(plain.length(), start + max)).trim();
        return (start > 0 ? "…" : "") + cut + (start + max < plain.length() ? "…" : "");
    }

    private static boolean isEmailChar(char c) {
        return Character.isLetterOrDigit(c) || c == '.' || c == '_' || c == '%' || c == '+' || c == '-';
    }

    private static boolean isWordChar(char c) {
        return Character.isLetterOrDigit(c) || c == '_';
    }
}
