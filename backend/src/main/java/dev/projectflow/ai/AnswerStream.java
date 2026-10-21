package dev.projectflow.ai;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Picks the answer's own words out of the model's reply while it's being written. Flurry's reply
 * is a JSON object ({"answer": "...", "citedTasks": [...], ...}), so only the text of its "answer"
 * string is passed on, unescaped as it arrives. Everything before it (a code fence, a sentence, a
 * model's {@code <think>} block), the JSON around it and everything after it are held back. What
 * it passes on is provisional: the checked answer replaces it once the reply is complete. A reply
 * without an "answer" string passes nothing on; its checked answer still arrives at the end.
 */
final class AnswerStream {

    private static final Pattern KEY = Pattern.compile("\"answer\"\\s*:\\s*\"", Pattern.CASE_INSENSITIVE);
    private static final String THINK = "<think>";
    private static final String THOUGHT = "</think>";
    /** While looking for the answer, at most this much of the reply is kept (its end, where the key may be starting). */
    private static final int MAX_SEARCH = 64_000;
    private static final int KEEP_WHEN_TRIMMED = 2_000;

    private enum State { SEARCHING, IN_ANSWER, DONE }

    private final StringBuilder raw = new StringBuilder();
    private State state = State.SEARCHING;
    /** The next character of {@code raw} to read, inside the answer. */
    private int pos;
    /** A high surrogate held back until the low one that completes it arrives. */
    private char pendingHigh;

    /** Starts over (the model's next turn). */
    void reset() {
        raw.setLength(0);
        state = State.SEARCHING;
        pos = 0;
        pendingHigh = 0;
    }

    /** True once the answer's closing quote has been read. */
    boolean finished() {
        return state == State.DONE;
    }

    /** Adds more of the reply; returns the answer's text it completes (often empty). */
    String accept(String chunk) {
        if (chunk == null || chunk.isEmpty() || state == State.DONE) return "";
        raw.append(chunk);
        if (state == State.SEARCHING && !find()) return "";
        StringBuilder out = new StringBuilder();
        if (pendingHigh != 0) {
            out.append(pendingHigh);
            pendingHigh = 0;
        }
        while (pos < raw.length()) {
            char c = raw.charAt(pos);
            if (c == '"') {
                state = State.DONE;
                break;
            }
            if (c != '\\') {
                out.append(c);
                pos++;
                continue;
            }
            if (pos + 1 >= raw.length()) break; // the escape's next character hasn't arrived
            char e = raw.charAt(pos + 1);
            if (e == 'u') {
                if (pos + 6 > raw.length()) break; // nor all four hex digits
                try {
                    out.append((char) Integer.parseInt(raw.substring(pos + 2, pos + 6), 16));
                } catch (NumberFormatException ignored) {
                    // not an escape after all: leave it out
                }
                pos += 6;
                continue;
            }
            out.append(switch (e) {
                case 'n' -> '\n';
                case 't' -> '\t';
                case 'r' -> '\r';
                case 'b' -> '\b';
                case 'f' -> '\f';
                default -> e; // \" \\ \/ and anything a model invents: the character itself
            });
            pos += 2;
        }
        int last = out.length() - 1;
        if (last >= 0 && Character.isHighSurrogate(out.charAt(last))) {
            if (state == State.DONE) {
                out.setLength(last); // never completed: drop it
            } else {
                pendingHigh = out.charAt(last);
                out.setLength(last);
            }
        }
        return out.toString();
    }

    /** Looks for the start of the answer's string, outside any {@code <think>} block; true when found. */
    private boolean find() {
        int from = 0;
        int open = raw.lastIndexOf(THINK);
        if (open >= 0) {
            int close = raw.indexOf(THOUGHT, open);
            if (close < 0) return false; // still thinking
            from = close + THOUGHT.length();
        }
        Matcher m = KEY.matcher(raw);
        if (m.find(from)) {
            pos = m.end();
            state = State.IN_ANSWER;
            return true;
        }
        if (raw.length() > MAX_SEARCH && open < 0) raw.delete(0, raw.length() - KEEP_WHEN_TRIMMED);
        return false;
    }
}
