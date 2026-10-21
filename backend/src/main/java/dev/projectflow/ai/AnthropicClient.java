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

/** Minimal client for Anthropic's Messages API using the JDK HTTP client (no extra dependency). */
public class AnthropicClient implements AiClient, ToolChat {

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ObjectMapper json;
    private final String baseUrl;
    private final String apiKey;
    private final String model;

    public AnthropicClient(ObjectMapper json, String baseUrl, String apiKey, String model) {
        this.json = json;
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.apiKey = apiKey;
        this.model = model;
    }

    @Override
    public Completion complete(String system, String user, int maxTokens) {
        try {
            ObjectNode body = json.createObjectNode();
            body.put("model", model);
            body.put("max_tokens", maxTokens);
            body.put("system", system);
            ObjectNode message = body.putArray("messages").addObject();
            message.put("role", "user");
            message.put("content", user);
            HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/v1/messages"))
                    .timeout(Duration.ofSeconds(60))
                    .header("content-type", "application/json")
                    .header("x-api-key", apiKey)
                    .header("anthropic-version", "2023-06-01")
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                throw new AiClientException("AI provider returned HTTP " + res.statusCode(), null);
            }
            JsonNode root = json.readTree(res.body());
            JsonNode content = root.path("content");
            StringBuilder text = new StringBuilder();
            for (JsonNode part : content) {
                if ("text".equals(part.path("type").asText())) text.append(part.path("text").asText());
            }
            if (text.isEmpty()) throw new AiClientException("AI provider returned no text", null);
            JsonNode usage = root.path("usage");
            return Completion.of(text.toString(), usage.path("input_tokens").asLong(0) + usage.path("output_tokens").asLong(0), system, user);
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

    /** Tool use with the Messages API: tool_use blocks out, tool_result blocks back in a user turn. */
    @Override
    public Turn next(String system, List<Msg> messages, List<ToolCatalog.Tool> tools, boolean allowCalls, int maxTokens) {
        try {
            ObjectNode body = toolBody(json, model, system, messages, tools, allowCalls, maxTokens);
            HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/v1/messages"))
                    .timeout(Duration.ofSeconds(90))
                    .header("content-type", "application/json")
                    .header("x-api-key", apiKey)
                    .header("anthropic-version", "2023-06-01")
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                if (!tools.isEmpty() && messages.size() == 1 && ToolChat.refusesTools(res.statusCode(), res.body())) {
                    throw new ToolsUnsupported("The AI provider refused the tools (HTTP " + res.statusCode() + ")");
                }
                throw new AiClientException("AI provider returned HTTP " + res.statusCode(), null);
            }
            return parseTurn(json.readTree(res.body()), system, messages);
        } catch (AiClientException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AiClientException("AI request was interrupted", e);
        } catch (Exception e) {
            throw new AiClientException("AI request failed: " + e.getClass().getSimpleName(), e);
        }
    }

    static final Duration STREAM_IDLE = Duration.ofSeconds(90);
    static final Duration STREAM_TOTAL = Duration.ofSeconds(180);

    /** The same step as {@link #next}, streamed: text as it's written, tool input put back together, stopped at once when asked. */
    @Override
    public Turn stream(String system, List<Msg> messages, List<ToolCatalog.Tool> tools, boolean allowCalls, int maxTokens, Sink sink) {
        if (sink.stopped()) throw new Stopped();
        StreamReader reader = new StreamReader(json, sink);
        StreamedHttp.Result res;
        try {
            ObjectNode body = toolBody(json, model, system, messages, tools, allowCalls, maxTokens);
            body.put("stream", true);
            HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/v1/messages"))
                    .timeout(STREAM_TOTAL)
                    .header("content-type", "application/json")
                    .header("accept", "text/event-stream")
                    .header("x-api-key", apiKey)
                    .header("anthropic-version", "2023-06-01")
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
                    .build();
            res = StreamedHttp.send(http, req, reader, sink::stopped, STREAM_IDLE, STREAM_TOTAL);
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
     * Puts a streamed Messages reply back together from its events (message_start,
     * content_block_start/delta/stop, message_delta, message_stop): text blocks go on to the sink as
     * they come, a tool_use block's input arrives as pieces of JSON. Thinking blocks and pings are
     * skipped; an error event fails the request.
     */
    static final class StreamReader implements StreamedHttp.Reader {
        private static final class Partial {
            String id = "";
            String name = "";
            final StringBuilder input = new StringBuilder();
        }

        private final ObjectMapper json;
        private final Sink sink;
        private final StringBuilder text = new StringBuilder();
        private final java.util.TreeMap<Integer, Partial> tools = new java.util.TreeMap<>();
        private long inputTokens;
        private long outputTokens;
        private boolean ended;

        StreamReader(ObjectMapper json, Sink sink) {
            this.json = json;
            this.sink = sink;
        }

        private void say(String t) {
            if (t == null || t.isEmpty()) return;
            text.append(t);
            sink.text(t);
        }

        @Override
        public void line(String line) throws Exception {
            String l = line.strip();
            if (!l.startsWith("data:")) return; // event: lines name what the data says itself
            String data = l.substring(5).strip();
            if (data.isEmpty()) return;
            JsonNode n = json.readTree(data);
            switch (n.path("type").asText()) {
                case "message_start" -> {
                    JsonNode u = n.path("message").path("usage");
                    inputTokens = u.path("input_tokens").asLong(0) + u.path("cache_creation_input_tokens").asLong(0) + u.path("cache_read_input_tokens").asLong(0);
                    outputTokens = u.path("output_tokens").asLong(0);
                }
                case "content_block_start" -> {
                    JsonNode b = n.path("content_block");
                    String type = b.path("type").asText();
                    if ("text".equals(type)) {
                        say(b.path("text").asText(""));
                    } else if ("tool_use".equals(type)) {
                        Partial p = new Partial();
                        p.id = b.path("id").asText("");
                        p.name = b.path("name").asText("");
                        if (b.path("input").isObject() && !b.path("input").isEmpty()) p.input.append(json.writeValueAsString(b.path("input")));
                        tools.put(n.path("index").asInt(tools.size()), p);
                    }
                }
                case "content_block_delta" -> {
                    JsonNode d = n.path("delta");
                    switch (d.path("type").asText()) {
                        case "text_delta" -> say(d.path("text").asText(""));
                        case "input_json_delta" -> {
                            Partial p = tools.get(n.path("index").asInt(-1));
                            if (p != null) p.input.append(d.path("partial_json").asText(""));
                        }
                        default -> { /* thinking and signatures aren't part of the answer */ }
                    }
                }
                case "message_delta" -> {
                    long out = n.path("usage").path("output_tokens").asLong(0);
                    if (out > 0) outputTokens = out;
                }
                case "message_stop" -> ended = true;
                case "error" -> throw new AiClientException("AI provider reported an error while answering: " + n.path("error").path("type").asText("unknown"), null);
                default -> { /* ping, content_block_stop */ }
            }
        }

        boolean ended() {
            return ended;
        }

        Turn turn(String system, List<Msg> messages) {
            List<Call> calls = new ArrayList<>();
            for (Partial p : tools.values()) {
                if (p.name.isBlank()) continue;
                calls.add(new Call(p.id.isBlank() ? "call_" + (calls.size() + 1) : p.id, p.name.trim(),
                        OpenAiCompatibleClient.arguments(json, json.getNodeFactory().textNode(p.input.toString()))));
            }
            String t = text.toString();
            if (t.isEmpty() && calls.isEmpty()) {
                throw new AiClientException(ended ? "AI provider returned no text and no tool calls" : "AI provider’s reply ended before it began", null);
            }
            long reported = inputTokens + outputTokens;
            return new Turn(t, calls, reported > 0 ? reported : OpenAiCompatibleClient.estimate(system, messages, t));
        }
    }

    static ObjectNode toolBody(ObjectMapper json, String model, String system, List<Msg> messages, List<ToolCatalog.Tool> tools, boolean allowCalls, int maxTokens) {
        ObjectNode body = json.createObjectNode();
        body.put("model", model);
        body.put("max_tokens", maxTokens);
        body.put("system", system);
        ArrayNode out = body.putArray("messages");
        ArrayNode pendingResults = null; // tool results go back together, in one user turn
        for (Msg m : messages) {
            if (!(m instanceof ToolMsg)) pendingResults = null;
            switch (m) {
                case UserMsg u -> out.addObject().put("role", "user").put("content", u.text());
                case AssistantMsg a -> {
                    ArrayNode content = out.addObject().put("role", "assistant").putArray("content");
                    if (a.text() != null && !a.text().isBlank()) content.addObject().put("type", "text").put("text", a.text());
                    for (Call c : a.calls()) content.addObject().put("type", "tool_use").put("id", c.id()).put("name", c.name()).set("input", c.arguments());
                }
                case ToolMsg t -> {
                    if (pendingResults == null) pendingResults = out.addObject().put("role", "user").putArray("content");
                    pendingResults.addObject().put("type", "tool_result").put("tool_use_id", t.callId()).put("content", t.content());
                }
            }
        }
        if (!tools.isEmpty()) {
            ArrayNode list = body.putArray("tools");
            for (ToolCatalog.Tool tool : tools) {
                list.addObject().put("name", tool.name()).put("description", tool.description()).set("input_schema", tool.parameters());
            }
            body.putObject("tool_choice").put("type", allowCalls ? "auto" : "none");
        }
        return body;
    }

    static Turn parseTurn(JsonNode root, String system, List<Msg> messages) {
        StringBuilder text = new StringBuilder();
        List<Call> calls = new ArrayList<>();
        for (JsonNode part : root.path("content")) {
            switch (part.path("type").asText()) {
                case "text" -> text.append(part.path("text").asText());
                case "tool_use" -> {
                    String name = part.path("name").asText("").trim();
                    if (!name.isEmpty()) calls.add(new Call(part.path("id").asText("call_" + (calls.size() + 1)), name, part.path("input").isObject() ? part.path("input") : new ObjectMapper().createObjectNode()));
                }
                default -> { /* thinking and other blocks aren't part of the answer */ }
            }
        }
        if (text.isEmpty() && calls.isEmpty()) throw new AiClientException("AI provider returned no text and no tool calls", null);
        JsonNode usage = root.path("usage");
        long reported = usage.path("input_tokens").asLong(0) + usage.path("output_tokens").asLong(0);
        return new Turn(text.toString(), calls, reported > 0 ? reported : OpenAiCompatibleClient.estimate(system, messages, text.toString()));
    }
}
