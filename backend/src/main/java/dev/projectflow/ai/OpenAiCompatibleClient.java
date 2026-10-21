package dev.projectflow.ai;

import com.fasterxml.jackson.core.JsonProcessingException;
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

/**
 * Client for any service that speaks the OpenAI "chat completions" API. That covers free options:
 * Ollama on your own computer (no key, e.g. http://localhost:11434/v1), and the free tiers of
 * Groq and Google Gemini, as well as OpenRouter, LM Studio and OpenAI itself. The key (if any)
 * stays on the server.
 */
public class OpenAiCompatibleClient implements AiClient, ToolChat {

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ObjectMapper json;
    private final String baseUrl;
    private final String apiKey;
    private final String model;

    public OpenAiCompatibleClient(ObjectMapper json, String baseUrl, String apiKey, String model) {
        this.json = json;
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.model = model;
    }

    @Override
    public Completion complete(String system, String user, int maxTokens) {
        try {
            ObjectNode body = json.createObjectNode();
            body.put("model", model);
            body.put("max_tokens", maxTokens);
            body.put("temperature", 0.2);
            ArrayNode messages = body.putArray("messages");
            messages.addObject().put("role", "system").put("content", system);
            messages.addObject().put("role", "user").put("content", user);
            HttpRequest.Builder req = HttpRequest.newBuilder(URI.create(baseUrl + "/chat/completions"))
                    // Local models on a laptop can be slow to answer.
                    .timeout(Duration.ofSeconds(120))
                    .header("content-type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
            if (!apiKey.isEmpty()) req.header("authorization", "Bearer " + apiKey);
            HttpResponse<String> res = http.send(req.build(), HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                throw new AiClientException("AI provider returned HTTP " + res.statusCode(), null);
            }
            JsonNode root = json.readTree(res.body());
            JsonNode content = root.path("choices").path(0).path("message").path("content");
            String text = content.isTextual() ? content.asText() : "";
            if (text.isBlank()) throw new AiClientException("AI provider returned no text", null);
            return Completion.of(text, root.path("usage").path("total_tokens").asLong(0), system, user);
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
     * Function calling in the OpenAI "chat completions" format, which Groq, Gemini's OpenAI
     * endpoint, OpenRouter, vLLM (for example serving Qwen3) and LM Studio speak too.
     */
    @Override
    public Turn next(String system, List<Msg> messages, List<ToolCatalog.Tool> tools, boolean allowCalls, int maxTokens) {
        try {
            ObjectNode body = toolBody(json, model, system, messages, tools, allowCalls, maxTokens);
            HttpRequest.Builder req = HttpRequest.newBuilder(URI.create(baseUrl + "/chat/completions"))
                    .timeout(Duration.ofSeconds(120))
                    .header("content-type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
            if (!apiKey.isEmpty()) req.header("authorization", "Bearer " + apiKey);
            HttpResponse<String> res = http.send(req.build(), HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                // Refused on the very first request with tools: this model or service doesn't do function calling.
                if (!tools.isEmpty() && messages.size() == 1 && ToolChat.refusesTools(res.statusCode(), res.body())) {
                    throw new ToolsUnsupported("The AI provider refused the tools (HTTP " + res.statusCode() + ")");
                }
                throw new AiClientException("AI provider returned HTTP " + res.statusCode(), null);
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

    /** How long a streamed reply may go without sending anything, and take in all. */
    static final Duration STREAM_IDLE = Duration.ofSeconds(120);
    static final Duration STREAM_TOTAL = Duration.ofSeconds(240);

    /**
     * The same step as {@link #next}, streamed ({@code "stream": true}): the text is handed on as it
     * arrives, tool calls are put back together from their pieces, and the request is cancelled as
     * soon as the person stops the question.
     */
    @Override
    public Turn stream(String system, List<Msg> messages, List<ToolCatalog.Tool> tools, boolean allowCalls, int maxTokens, Sink sink) {
        if (sink.stopped()) throw new Stopped();
        StreamReader reader = new StreamReader(json, sink);
        StreamedHttp.Result res;
        try {
            ObjectNode body = toolBody(json, model, system, messages, tools, allowCalls, maxTokens);
            body.put("stream", true);
            // OpenAI reports what a streamed reply used only when asked (others report it anyway, or not at all).
            if (baseUrl.contains("api.openai.com")) body.putObject("stream_options").put("include_usage", true);
            HttpRequest.Builder req = HttpRequest.newBuilder(URI.create(baseUrl + "/chat/completions"))
                    .timeout(STREAM_TOTAL)
                    .header("content-type", "application/json")
                    .header("accept", "text/event-stream")
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
            if (!apiKey.isEmpty()) req.header("authorization", "Bearer " + apiKey);
            res = StreamedHttp.send(http, req.build(), reader, sink::stopped, STREAM_IDLE, STREAM_TOTAL);
        } catch (AiClientException e) {
            throw e;
        } catch (Exception e) {
            throw new AiClientException("AI request failed: " + e.getClass().getSimpleName(), e);
        }
        if (!res.ok()) {
            if (!tools.isEmpty() && messages.size() == 1 && ToolChat.refusesTools(res.status(), res.errorBody())) {
                throw new ToolsUnsupported("The AI provider refused the tools (HTTP " + res.status() + ")");
            }
            throw new AiClientException("AI provider returned HTTP " + res.status(), null);
        }
        return reader.turn(system, messages);
    }

    /**
     * Puts a streamed chat-completions reply back together: {@code data:} lines of JSON chunks
     * ending with {@code data: [DONE]}. The text goes on to the sink as it comes; a tool call's
     * name comes once and its arguments in pieces, matched by their index (or id, for services
     * that send none). Usage is read when the service reports it (OpenAI when asked, Groq under
     * x_groq, OpenRouter in the last chunk); otherwise it's estimated.
     */
    static final class StreamReader implements StreamedHttp.Reader {
        private static final class Partial {
            String id = "";
            String name = "";
            final StringBuilder arguments = new StringBuilder();
        }

        private final ObjectMapper json;
        private final Sink sink;
        private final StringBuilder text = new StringBuilder();
        private final List<Partial> calls = new ArrayList<>();
        private final java.util.Map<Integer, Partial> byIndex = new java.util.HashMap<>();
        private long tokens;
        private boolean ended;

        StreamReader(ObjectMapper json, Sink sink) {
            this.json = json;
            this.sink = sink;
        }

        @Override
        public void line(String line) throws Exception {
            String l = line.strip();
            if (!l.startsWith("data:")) return; // blank lines, ": comments" (keep-alives), event: and id: lines
            String data = l.substring(5).strip();
            if (data.isEmpty()) return;
            if (data.equals("[DONE]")) {
                ended = true;
                return;
            }
            JsonNode n = json.readTree(data);
            if (n.hasNonNull("error")) {
                JsonNode e = n.get("error");
                throw new AiClientException("AI provider reported an error while answering: " + (e.isTextual() ? e.asText() : e.path("message").asText(e.path("type").asText("unknown"))), null);
            }
            long reported = Math.max(n.path("usage").path("total_tokens").asLong(0), n.path("x_groq").path("usage").path("total_tokens").asLong(0));
            if (reported > 0) tokens = reported;
            JsonNode choice = n.path("choices").path(0);
            if (choice.hasNonNull("finish_reason")) ended = true;
            JsonNode delta = choice.has("delta") ? choice.get("delta") : choice.path("message");
            JsonNode content = delta.path("content");
            if (content.isTextual() && !content.asText().isEmpty()) {
                text.append(content.asText());
                sink.text(content.asText());
            }
            for (JsonNode tc : delta.path("tool_calls")) {
                Partial p = partial(tc);
                String id = tc.path("id").asText("");
                if (!id.isEmpty() && p.id.isEmpty()) p.id = id;
                JsonNode fn = tc.path("function");
                String name = fn.path("name").asText("");
                if (!name.isEmpty() && p.name.isEmpty()) p.name = name;
                JsonNode args = fn.path("arguments");
                if (args.isTextual()) {
                    p.arguments.append(args.asText());
                } else if (args.isObject()) {
                    p.arguments.setLength(0);
                    p.arguments.append(json.writeValueAsString(args));
                }
            }
        }

        private Partial partial(JsonNode tc) {
            if (tc.has("index") && tc.get("index").canConvertToInt()) return byIndex.computeIfAbsent(tc.get("index").asInt(), i -> add());
            String id = tc.path("id").asText("");
            if (!id.isEmpty()) {
                for (Partial p : calls) if (p.id.equals(id)) return p;
                return add();
            }
            if (calls.isEmpty() || !tc.path("function").path("name").asText("").isEmpty()) return add();
            return calls.get(calls.size() - 1);
        }

        private Partial add() {
            Partial p = new Partial();
            calls.add(p);
            return p;
        }

        boolean ended() {
            return ended;
        }

        Turn turn(String system, List<Msg> messages) {
            List<Call> out = new ArrayList<>();
            int n = 0;
            for (Partial p : calls) {
                n++;
                if (p.name.isBlank()) continue;
                out.add(new Call(p.id.isBlank() ? "call_" + n : p.id, p.name.trim(), arguments(json, json.getNodeFactory().textNode(p.arguments.toString()))));
            }
            String t = text.toString();
            if (t.isBlank() && out.isEmpty()) {
                throw new AiClientException(ended ? "AI provider returned no text and no tool calls" : "AI provider’s reply ended before it began", null);
            }
            return new Turn(t, out, tokens > 0 ? tokens : estimate(system, messages, t));
        }
    }

    static ObjectNode toolBody(ObjectMapper json, String model, String system, List<Msg> messages, List<ToolCatalog.Tool> tools, boolean allowCalls, int maxTokens)
            throws JsonProcessingException {
        ObjectNode body = json.createObjectNode();
        body.put("model", model);
        body.put("max_tokens", maxTokens);
        body.put("temperature", 0.2);
        ArrayNode out = body.putArray("messages");
        out.addObject().put("role", "system").put("content", system);
        for (Msg m : messages) {
            switch (m) {
                case UserMsg u -> out.addObject().put("role", "user").put("content", u.text());
                case AssistantMsg a -> {
                    ObjectNode o = out.addObject();
                    o.put("role", "assistant");
                    if (a.text() == null || a.text().isBlank()) o.putNull("content");
                    else o.put("content", a.text());
                    ArrayNode calls = o.putArray("tool_calls");
                    for (Call c : a.calls()) {
                        ObjectNode call = calls.addObject();
                        call.put("id", c.id());
                        call.put("type", "function");
                        ObjectNode fn = call.putObject("function");
                        fn.put("name", c.name());
                        fn.put("arguments", json.writeValueAsString(c.arguments())); // a JSON string, as the format requires
                    }
                }
                case ToolMsg t -> out.addObject().put("role", "tool").put("tool_call_id", t.callId()).put("content", t.content());
            }
        }
        if (!tools.isEmpty()) {
            ArrayNode list = body.putArray("tools");
            for (ToolCatalog.Tool tool : tools) {
                ObjectNode fn = list.addObject().put("type", "function").putObject("function");
                fn.put("name", tool.name());
                fn.put("description", tool.description());
                fn.set("parameters", tool.parameters());
            }
            body.put("tool_choice", allowCalls ? "auto" : "none");
        }
        return body;
    }

    static Turn parseTurn(ObjectMapper json, JsonNode root, String system, List<Msg> messages) {
        JsonNode message = root.path("choices").path(0).path("message");
        String text = message.path("content").isTextual() ? message.path("content").asText() : "";
        List<Call> calls = new ArrayList<>();
        int n = 0;
        for (JsonNode c : message.path("tool_calls")) {
            n++;
            String name = c.path("function").path("name").asText("").trim();
            if (name.isEmpty()) continue;
            String id = c.path("id").asText("").isBlank() ? "call_" + n : c.path("id").asText();
            calls.add(new Call(id, name, arguments(json, c.path("function").path("arguments"))));
        }
        if (text.isBlank() && calls.isEmpty()) throw new AiClientException("AI provider returned no text and no tool calls", null);
        long reported = root.path("usage").path("total_tokens").asLong(0);
        return new Turn(text, calls, reported > 0 ? reported : estimate(system, messages, text));
    }

    /** Arguments arrive as a JSON string (sometimes as an object); anything unreadable becomes {}. */
    static JsonNode arguments(ObjectMapper json, JsonNode raw) {
        try {
            JsonNode n = raw.isTextual() ? json.readTree(raw.asText().isBlank() ? "{}" : raw.asText()) : raw;
            return n != null && n.isObject() ? n : json.createObjectNode();
        } catch (Exception e) {
            return json.createObjectNode();
        }
    }

    static long estimate(String system, List<Msg> messages, String reply) {
        StringBuilder all = new StringBuilder(system == null ? "" : system);
        for (Msg m : messages) {
            switch (m) {
                case UserMsg u -> all.append(u.text());
                case AssistantMsg a -> all.append(a.text() == null ? "" : a.text()).append(a.calls().toString());
                case ToolMsg t -> all.append(t.content());
            }
        }
        return Completion.estimate(all.toString(), reply);
    }
}
