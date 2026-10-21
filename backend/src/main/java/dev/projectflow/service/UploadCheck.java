package dev.projectflow.service;

import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Which uploads are accepted and how they're labelled. The type a file is stored and served with
 * comes from its extension (from an allowlist), never from what the browser declared; formats with
 * a recognisable signature must start with it, so an "image" that is really a web page is refused.
 * Images of the four inline types are the only files ever shown in the page; everything else is
 * served as a download.
 */
final class UploadCheck {

    private UploadCheck() {}

    /** The stored type for each allowed extension. */
    static final Map<String, String> TYPES = Map.ofEntries(
            Map.entry("png", "image/png"), Map.entry("jpg", "image/jpeg"), Map.entry("jpeg", "image/jpeg"), Map.entry("gif", "image/gif"),
            Map.entry("webp", "image/webp"), Map.entry("svg", "image/svg+xml"), Map.entry("pdf", "application/pdf"),
            Map.entry("txt", "text/plain"), Map.entry("md", "text/markdown"), Map.entry("csv", "text/csv"), Map.entry("tsv", "text/tab-separated-values"),
            Map.entry("json", "application/json"), Map.entry("log", "text/plain"), Map.entry("xml", "application/xml"), Map.entry("yaml", "application/yaml"),
            Map.entry("yml", "application/yaml"), Map.entry("doc", "application/msword"),
            Map.entry("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), Map.entry("xls", "application/vnd.ms-excel"),
            Map.entry("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), Map.entry("ppt", "application/vnd.ms-powerpoint"),
            Map.entry("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
            Map.entry("odt", "application/vnd.oasis.opendocument.text"), Map.entry("ods", "application/vnd.oasis.opendocument.spreadsheet"),
            Map.entry("odp", "application/vnd.oasis.opendocument.presentation"), Map.entry("rtf", "application/rtf"),
            Map.entry("key", "application/octet-stream"), Map.entry("numbers", "application/octet-stream"), Map.entry("pages", "application/octet-stream"),
            Map.entry("zip", "application/zip"), Map.entry("mp4", "video/mp4"), Map.entry("mov", "video/quicktime"), Map.entry("webm", "video/webm"),
            Map.entry("mp3", "audio/mpeg"), Map.entry("wav", "audio/wav"), Map.entry("m4a", "audio/mp4"), Map.entry("fig", "application/octet-stream"),
            Map.entry("sketch", "application/octet-stream"), Map.entry("drawio", "application/xml"), Map.entry("har", "application/json"));

    /** The only types ever shown inside the page; everything else is served as a download. */
    static final Set<String> INLINE_TYPES = Set.of("image/png", "image/jpeg", "image/gif", "image/webp");

    private static final Set<String> ZIP_BASED = Set.of("zip", "docx", "xlsx", "pptx", "odt", "ods", "odp");

    record Verdict(String contentType, String problem) {
        boolean ok() {
            return problem == null;
        }
    }

    static String extension(String name) {
        if (name == null) return "";
        int dot = name.lastIndexOf('.');
        return dot < 0 || dot == name.length() - 1 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    /** Whether a file named {@code name} whose content begins with {@code head} may be stored, and as what type. */
    static Verdict check(String name, byte[] head, Set<String> allowed) {
        String ext = extension(name);
        if (ext.isEmpty() || !allowed.contains(ext) || !TYPES.containsKey(ext)) {
            return new Verdict(null, "“" + name + "” can’t be attached: " + (ext.isEmpty() ? "files need an extension, such as .pdf or .png."
                    : "." + ext + " files aren’t accepted here. Use a common document, image, video or archive format, or share a link instead."));
        }
        String type = TYPES.get(ext);
        boolean matches = switch (ext) {
            case "png" -> starts(head, 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A);
            case "jpg", "jpeg" -> starts(head, 0xFF, 0xD8, 0xFF);
            case "gif" -> starts(head, 'G', 'I', 'F', '8');
            case "webp" -> starts(head, 'R', 'I', 'F', 'F') && head.length >= 12 && head[8] == 'W' && head[9] == 'E' && head[10] == 'B' && head[11] == 'P';
            case "pdf" -> starts(head, '%', 'P', 'D', 'F', '-');
            default -> !ZIP_BASED.contains(ext) || starts(head, 'P', 'K', 3, 4) || starts(head, 'P', 'K', 5, 6);
        };
        if (!matches) {
            return new Verdict(null, "“" + name + "” isn’t a valid ." + ext + " file: its contents don’t match its name. Save it again in that format, or rename it to match what it is.");
        }
        return new Verdict(type, null);
    }

    private static boolean starts(byte[] head, int... magic) {
        if (head == null || head.length < magic.length) return false;
        for (int i = 0; i < magic.length; i++) if ((head[i] & 0xFF) != (magic[i] & 0xFF)) return false;
        return true;
    }
}
