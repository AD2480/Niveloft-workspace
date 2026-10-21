package dev.projectflow.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Ollama's own chat API, for a free model running on the same computer as the backend (no key,
 * nothing leaves the machine). The native API is used rather than Ollama's OpenAI-compatible one
 * because it lets us ask for JSON output and a context window big enough for a project's records
 * (Ollama's default is small and it silently cuts longer prompts).
 */
public class OllamaClient implements AiClient, ToolChat {

    /** Chat models that follow instructions and JSON well at laptop sizes, best first. */
    static final List<String> PREFERRED = List.of("llama3.2", "qwen2.5", "llama3.1", "qwen3", "gemma3", "gemma2", "mistral", "phi4", "phi3", "llama3");
    private static final int CONTEXT_TOKENS = 8192;

    private final HttpClient http;
    private final ObjectMapper json;
    private final String baseUrl;
    private final String model;

    public OllamaClient(ObjectMapper json, String baseUrl, String model) {
        this(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build(), json, baseUrl, model);
    }

    /** The same Ollama, answering with another installed model. */
    public OllamaClient withModel(String other) {
        return new OllamaClient(http, json, baseUrl, other);
    }

    OllamaClient(HttpClient http, ObjectMapper json, String baseUrl, String model) {
        this.http = http;
        this.json = json;
        this.baseUrl = root(baseUrl);
        this.model = model;
    }

    public String model() {
        return model;
    }

    public String baseUrl() {
        return baseUrl;
    }

    @Override
    public Completion complete(String system, String user, int maxTokens) {
        try {
            ObjectNode body = json.createObjectNode();
            body.put("model", model);
            body.put("stream", false);
            body.put("format", "json");
            ObjectNode options = body.putObject("options");
            options.put("temperature", 0.2);
            options.put("num_ctx", CONTEXT_TOKENS);
            options.put("num_predict", maxTokens);
            ArrayNode messages = body.putArray("messages");
            messages.addObject().put("role", "system").put("content", system);
            messages.addObject().put("role", "user").put("content", user);
            HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/api/chat"))
                    // A laptop may need a while, especially the first time a model is loaded.
                    .timeout(Duration.ofSeconds(180))
                    .header("content-type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) throw new AiClientException("Ollama returned HTTP " + res.statusCode(), null);
            JsonNode root = json.readTree(res.body());
            JsonNode content = root.path("message").path("content");
            String text = content.isTextual() ? content.asText() : "";
            if (text.isBlank()) throw new AiClientException("Ollama returned no text", null);
            return Completion.of(text, root.path("prompt_eval_count").asLong(0) + root.path("eval_count").asLong(0), system, user);
        } catch (AiClientException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AiClientException("AI request was interrupted", e);
        } catch (Exception e) {
            throw new AiClientException("AI request failed: " + e.getClass().getSimpleName(), e);
        }
    }

    // ------------------------------------------------------------------ tools

    /**
     * Function calling with Ollama's own chat API. Models that support tools (Llama 3.1/3.2,
     * Qwen 2.5/3, Mistral and others) ask for calls in {@code message.tool_calls}; a model without
     * tool support makes Ollama refuse the request, and the caller asks again without tools.
     */
    @Override
    public Turn next(String system, List<Msg> messages, List<ToolCatalog.Tool> tools, boolean allowCalls, int maxTokens) {
        try {
            ObjectNode body = toolBody(json, model, system, messages, tools, allowCalls, maxTokens);
            HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/api/chat"))
                    .timeout(Duration.ofSeconds(180))
                    .header("content-type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                if (allowCalls && !tools.isEmpty() && messages.size() == 1 && ToolChat.refusesTools(res.statusCode(), res.body())) {
                    throw new ToolsUnsupported("Ollama refused the tools for model " + model + " (HTTP " + res.statusCode() + ")");
                }
                throw new AiClientException("Ollama returned HTTP " + res.statusCode(), null);
            }
            return parseTurn(json, json.readTree(res.body()), system, messages);
        } catch (AiClientException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AiClientException("AI request was interrupted", e);
        } catch (Exception e) {
            throw new AiClientException("AI request failed: " + e.getClass().getSimpleName(), e);
        }
    }

    /** Loading a model on a laptop can take a while before the first word. */
    static final Duration STREAM_IDLE = Duration.ofSeconds(180);
    static final Duration STREAM_TOTAL = Duration.ofSeconds(300);

    /** The same step as {@link #next}, streamed (JSON lines): text as it's written, stopped at once when asked. */
    @Override
    public Turn stream(String system, List<Msg> messages, List<ToolCatalog.Tool> tools, boolean allowCalls, int maxTokens, Sink sink) {
        if (sink.stopped()) throw new Stopped();
        StreamReader reader = new StreamReader(json, sink);
        StreamedHttp.Result res;
        try {
            ObjectNode body = toolBody(json, model, system, messages, tools, allowCalls, maxTokens);
            body.put("stream", true);
            HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/api/chat"))
                    .timeout(STREAM_TOTAL)
                    .header("content-type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
                    .build();
            res = StreamedHttp.send(http, req, reader, sink::stopped, STREAM_IDLE, STREAM_TOTAL);
        } catch (AiClientException e) {
            throw e;
        } catch (Exception e) {
            throw new AiClientException("AI request failed: " + e.getClass().getSimpleName(), e);
        }
        if (!res.ok()) {
            if (allowCalls && !tools.isEmpty() && messages.size() == 1 && ToolChat.refusesTools(res.status(), res.errorBody())) {
                throw new ToolsUnsupported("Ollama refused the tools for model " + model + " (HTTP " + res.status() + ")");
            }
            throw new AiClientException("Ollama returned HTTP " + res.status(), null);
        }
        return reader.turn(system, messages);
    }

    /**
     * Puts a streamed /api/chat reply back together: one JSON object per line, each with a piece of
     * the message; tool calls come whole; the last line says done and how many tokens were used.
     * A model's thinking (message.thinking) isn't part of the answer.
     */
    static final class StreamReader implements StreamedHttp.Reader {
        private final ObjectMapper json;
        private final Sink sink;
        private final StringBuilder text = new StringBuilder();
        private final List<Call> calls = new ArrayList<>();
        private long tokens;
        private boolean ended;

        StreamReader(ObjectMapper json, Sink sink) {
            this.json = json;
            this.sink = sink;
        }

        @Override
        public void line(String line) throws Exception {
            String l = line.strip();
            if (l.isEmpty()) return;
            JsonNode n = json.readTree(l);
            if (n.hasNonNull("error")) throw new AiClientException("Ollama reported an error while answering: " + n.get("error").asText(), null);
            JsonNode message = n.path("message");
            JsonNode content = message.path("content");
            if (content.isTextual() && !content.asText().isEmpty()) {
                text.append(content.asText());
                sink.text(content.asText());
            }
            for (JsonNode c : message.path("tool_calls")) {
                String name = c.path("function").path("name").asText("").trim();
                if (name.isEmpty()) continue;
                String id = c.path("id").asText("").isBlank() ? "call_" + (calls.size() + 1) : c.path("id").asText();
                calls.add(new Call(id, name, OpenAiCompatibleClient.arguments(json, c.path("function").path("arguments"))));
            }
            if (n.path("done").asBoolean(false)) {
                ended = true;
                tokens = n.path("prompt_eval_count").asLong(0) + n.path("eval_count").asLong(0);
            }
        }

        boolean ended() {
            return ended;
        }

        Turn turn(String system, List<Msg> messages) {
            String t = text.toString();
            if (t.isBlank() && calls.isEmpty()) {
                throw new AiClientException(ended ? "Ollama returned no text and no tool calls" : "Ollama’s reply ended before it began", null);
            }
            return new Turn(t, List.copyOf(calls), tokens > 0 ? tokens : OpenAiCompatibleClient.estimate(system, messages, t));
        }
    }

    static ObjectNode toolBody(ObjectMapper json, String model, String system, List<Msg> messages, List<ToolCatalog.Tool> tools, boolean allowCalls, int maxTokens) {
        ObjectNode body = json.createObjectNode();
        body.put("model", model);
        body.put("stream", false);
        ObjectNode options = body.putObject("options");
        options.put("temperature", 0.2);
        options.put("num_ctx", CONTEXT_TOKENS);
        options.put("num_predict", maxTokens);
        ArrayNode out = body.putArray("messages");
        out.addObject().put("role", "system").put("content", system);
        for (Msg m : messages) {
            switch (m) {
                case UserMsg u -> out.addObject().put("role", "user").put("content", u.text());
                case AssistantMsg a -> {
                    ObjectNode o = out.addObject();
                    o.put("role", "assistant");
                    o.put("content", a.text() == null ? "" : a.text());
                    ArrayNode calls = o.putArray("tool_calls");
                    for (Call c : a.calls()) calls.addObject().putObject("function").put("name", c.name()).set("arguments", c.arguments());
                }
                case ToolMsg t -> out.addObject().put("role", "tool").put("tool_name", t.name()).put("content", t.content());
            }
        }
        if (allowCalls && !tools.isEmpty()) {
            ArrayNode list = body.putArray("tools");
            for (ToolCatalog.Tool tool : tools) {
                ObjectNode fn = list.addObject().put("type", "function").putObject("function");
                fn.put("name", tool.name());
                fn.put("description", tool.description());
                fn.set("parameters", tool.parameters());
            }
        } else {
            // The answering turn: no tools offered, and JSON out.
            body.put("format", "json");
        }
        return body;
    }

    static Turn parseTurn(ObjectMapper json, JsonNode root, String system, List<Msg> messages) {
        JsonNode message = root.path("message");
        String text = message.path("content").isTextual() ? message.path("content").asText() : "";
        List<Call> calls = new ArrayList<>();
        int n = 0;
        for (JsonNode c : message.path("tool_calls")) {
            n++;
            String name = c.path("function").path("name").asText("").trim();
            if (name.isEmpty()) continue;
            String id = c.path("id").asText("").isBlank() ? "call_" + n : c.path("id").asText();
            calls.add(new Call(id, name, OpenAiCompatibleClient.arguments(json, c.path("function").path("arguments"))));
        }
        if (text.isBlank() && calls.isEmpty()) throw new AiClientException("Ollama returned no text and no tool calls", null);
        long reported = root.path("prompt_eval_count").asLong(0) + root.path("eval_count").asLong(0);
        return new Turn(text, calls, reported > 0 ? reported : OpenAiCompatibleClient.estimate(system, messages, text));
    }

    // ------------------------------------------------------------------ detection

    /**
     * What a look for Ollama found: a client to use (or why there isn't one), and every chat model
     * installed there (the Arena can ask any of them).
     */
    public record Detection(OllamaClient client, String reason, List<String> models) {
        public Detection(OllamaClient client, String reason) {
            this(client, reason, List.of());
        }
    }

    /**
     * Looks for Ollama at each address in turn and picks a chat model: {@code preferredModel} when
     * it's installed, otherwise the best one from {@link #PREFERRED}, otherwise any installed model
     * that isn't an embedding model.
     */
    static Detection detect(HttpClient http, ObjectMapper json, List<String> bases, String preferredModel) {
        String reason = "Ollama isn’t running on the computer that runs the backend.";
        for (String base : bases) {
            if (base == null || base.isBlank()) continue;
            String root = root(base);
            List<String> models;
            try {
                HttpRequest req = HttpRequest.newBuilder(URI.create(root + "/api/tags")).timeout(Duration.ofMillis(1500)).GET().build();
                HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
                if (res.statusCode() / 100 != 2) continue;
                models = new ArrayList<>();
                for (JsonNode m : json.readTree(res.body()).path("models")) {
                    String name = m.path("name").asText(m.path("model").asText("")).trim();
                    if (!name.isEmpty()) models.add(name);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return new Detection(null, reason);
            } catch (Exception e) {
                continue; // not there (connection refused, unknown host, timeout, not JSON)
            }
            String chosen = pick(models, preferredModel);
            if (chosen != null) {
                List<String> chat = models.stream().filter(n -> !n.toLowerCase(Locale.ROOT).contains("embed")).toList();
                return new Detection(new OllamaClient(http, json, root, chosen), null, chat);
            }
            reason = models.isEmpty()
                    ? "Ollama is running but has no models yet. Run: ollama pull llama3.2"
                    : "Ollama is running, but model “" + preferredModel + "” isn’t installed. Run: ollama pull " + preferredModel;
            // Keep looking: another address may have a usable model.
        }
        return new Detection(null, reason);
    }

    /** The model to use from what's installed, or null. */
    static String pick(List<String> installed, String preferredModel) {
        List<String> chat = installed.stream().filter(n -> !n.toLowerCase(Locale.ROOT).contains("embed")).toList();
        if (preferredModel != null && !preferredModel.isBlank()) {
            String want = preferredModel.trim().toLowerCase(Locale.ROOT);
            for (String n : installed) {
                String name = n.toLowerCase(Locale.ROOT);
                if (name.equals(want) || name.equals(want + ":latest")) return n;
            }
            return null; // asked for one that isn't installed: say so rather than silently use another
        }
        for (String family : PREFERRED) {
            for (String n : chat) {
                String name = n.toLowerCase(Locale.ROOT);
                if (name.equals(family) || name.startsWith(family + ":")) return n;
            }
        }
        return chat.isEmpty() ? null : chat.get(0);
    }

    /** "http://localhost:11434/v1/" → "http://localhost:11434" (Ollama's own API lives at the root). */
    static String root(String base) {
        String b = base.trim();
        while (b.endsWith("/")) b = b.substring(0, b.length() - 1);
        if (b.endsWith("/v1")) b = b.substring(0, b.length() - 3);
        return b;
    }
}
