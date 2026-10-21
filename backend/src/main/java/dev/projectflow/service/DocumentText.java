package dev.projectflow.service;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * How a project document is cut into passages and how its words are read for search. No Spring
 * here: the same rules are tested on their own and copied into the browser's test API.
 *
 * <p>Passages: the text is split at Markdown headings and blank lines, paragraphs are gathered
 * until a passage would pass about 900 characters, and a paragraph longer than 1,200 characters is
 * cut at sentence ends. Each passage remembers the headings above it ("Sessions › Timeouts"), so
 * an answer can say where in the document it read.
 */
public final class DocumentText {

    public static final int TARGET = 900;
    public static final int LONGEST_PARAGRAPH = 1_200;
    private static final Pattern HEADING = Pattern.compile("^(#{1,6})\\s+(.+?)\\s*#*\\s*$");
    private static final Pattern SENTENCE_END = Pattern.compile("(?<=[.!?])\\s+");
    private static final Pattern WORD = Pattern.compile("[\\p{L}\\p{N}]+");
    /** Words too common to say anything about a topic (English; other languages keep all words). */
    static final Set<String> STOP = Set.of("a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from", "has", "have", "how", "i", "if", "in",
            "is", "it", "its", "me", "my", "of", "on", "or", "our", "say", "says", "so", "that", "the", "their", "them", "there", "this", "to", "was", "we", "were",
            "what", "when", "where", "which", "who", "why", "will", "with", "you", "your", "about", "any", "did", "should", "would", "could", "tell");

    private DocumentText() {}

    public record Passage(int ordinal, String heading, String content) {}

    public static List<Passage> split(String body) {
        List<Passage> out = new ArrayList<>();
        List<String> path = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        String[] heading = {null};
        StringBuilder para = new StringBuilder();
        Runnable flush = () -> {
            if (!cur.toString().isBlank()) out.add(new Passage(out.size(), heading[0], cur.toString().strip()));
            cur.setLength(0);
        };
        Runnable endParagraph = () -> {
            String p = para.toString().strip();
            para.setLength(0);
            if (p.isEmpty()) return;
            for (String piece : pieces(p)) {
                if (cur.length() > 0 && cur.length() + piece.length() + 2 > TARGET) flush.run();
                if (cur.length() > 0) cur.append("\n\n");
                cur.append(piece);
            }
        };
        for (String line : (body == null ? "" : body).replace("\r\n", "\n").replace('\r', '\n').split("\n", -1)) {
            Matcher h = HEADING.matcher(line.strip());
            if (h.matches()) {
                endParagraph.run();
                flush.run();
                int level = h.group(1).length();
                while (path.size() >= level) path.remove(path.size() - 1);
                while (path.size() < level - 1) path.add("");
                path.add(h.group(2).strip());
                String joined = String.join(" › ", path.stream().filter(s -> !s.isEmpty()).toList());
                heading[0] = joined.isEmpty() ? null : (joined.length() > 300 ? joined.substring(0, 299) + "…" : joined);
            } else if (line.isBlank()) {
                endParagraph.run();
            } else {
                if (para.length() > 0) para.append('\n');
                para.append(line);
            }
        }
        endParagraph.run();
        flush.run();
        return out;
    }

    /** A paragraph as it goes into passages: whole when it's short enough, else cut at sentence ends. */
    static List<String> pieces(String p) {
        if (p.length() <= LONGEST_PARAGRAPH) return List.of(p);
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        for (String s : SENTENCE_END.split(p)) {
            while (s.length() > LONGEST_PARAGRAPH) {
                // One very long "sentence" (a list without full stops): cut at a space.
                int cut = s.lastIndexOf(' ', TARGET);
                cut = cut <= 0 ? TARGET : cut;
                if (cur.length() > 0) {
                    out.add(cur.toString().strip());
                    cur.setLength(0);
                }
                out.add(s.substring(0, cut).strip());
                s = s.substring(cut).strip();
            }
            if (cur.length() > 0 && cur.length() + s.length() + 1 > TARGET) {
                out.add(cur.toString().strip());
                cur.setLength(0);
            }
            if (cur.length() > 0) cur.append(' ');
            cur.append(s);
        }
        if (!cur.toString().isBlank()) out.add(cur.toString().strip());
        return out;
    }

    /** The words of a text for matching: lower case, accents kept, very common English words left out. */
    public static List<String> words(String text) {
        List<String> out = new ArrayList<>();
        if (text == null) return out;
        Matcher m = WORD.matcher(Normalizer.normalize(text, Normalizer.Form.NFC).toLowerCase(Locale.ROOT));
        while (m.find()) {
            String w = m.group();
            if (w.length() >= 2 && !STOP.contains(w)) out.add(w);
        }
        return out;
    }

    /** The distinct words of a query, at most {@code max}. */
    public static List<String> queryWords(String query, int max) {
        List<String> distinct = new ArrayList<>(new LinkedHashSet<>(words(query)));
        return List.copyOf(distinct.subList(0, Math.min(max, distinct.size())));
    }
}
