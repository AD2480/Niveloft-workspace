package dev.projectflow.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * The tools Flurry may call, read from {@code resources/ai/tools.json}: the same file the
 * tool-calling eval in {@code ml/niveloft_ml/tooleval.py} reads, so what's measured is what runs. Read tools
 * look at one project's records; proposal tools only ever produce suggestions.
 */
public final class ToolCatalog {

    public enum Kind { READ, PROPOSAL }

    public record Tool(String name, Kind kind, String description, JsonNode parameters) {}

    private final List<Tool> tools;

    private ToolCatalog(List<Tool> tools) {
        this.tools = List.copyOf(tools);
    }

    public static ToolCatalog load(ObjectMapper json) {
        try (InputStream in = ToolCatalog.class.getClassLoader().getResourceAsStream("ai/tools.json")) {
            if (in == null) throw new IllegalStateException("ai/tools.json is missing from the classpath");
            return parse(json.readTree(in));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    static ToolCatalog parse(JsonNode root) {
        List<Tool> out = new ArrayList<>();
        for (JsonNode t : root.path("tools")) {
            String name = t.path("name").asText("").trim();
            if (name.isEmpty() || !t.path("parameters").isObject()) throw new IllegalStateException("A tool in ai/tools.json has no name or parameters");
            Kind kind = Kind.valueOf(t.path("kind").asText("read").trim().toUpperCase(Locale.ROOT));
            out.add(new Tool(name, kind, t.path("description").asText(""), t.path("parameters")));
        }
        if (out.isEmpty()) throw new IllegalStateException("ai/tools.json lists no tools");
        return new ToolCatalog(out);
    }

    public List<Tool> all() {
        return tools;
    }

    public Optional<Tool> find(String name) {
        return tools.stream().filter(t -> t.name().equals(name)).findFirst();
    }
}
