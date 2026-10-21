package dev.projectflow.web;

/** Text from outside (browsers, headers) made safe for one log line. */
public final class LogText {

    private LogText() {}

    /** One line (line breaks shown as ⏎, other control characters removed), at most {@code max} characters. */
    public static String oneLine(String s, int max) {
        if (s == null || s.isBlank()) return "-";
        String flat = s.replaceAll("[\\r\\n\\t]+", " ⏎ ").replaceAll("\\p{Cntrl}", "");
        return flat.length() > max ? flat.substring(0, max) + "…" : flat;
    }
}
