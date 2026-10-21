package dev.projectflow.ai;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/**
 * A model that can call tools (function calling): OpenAI-compatible services (OpenAI, Groq,
 * Gemini, OpenRouter, vLLM serving Qwen3, LM Studio), Ollama and Anthropic each implement it in
 * their own wire format. The conversation is kept here in a neutral shape.
 */
public interface ToolChat {

    /**
     * One step: the model either answers ({@code calls} empty) or asks for tool calls. With
     * {@code allowCalls} false the tools stay described (some providers require that once the
     * history holds tool calls) but the model is told to answer now.
     */
    Turn next(String system, List<Msg> messages, List<ToolCatalog.Tool> tools, boolean allowCalls, int maxTokens);

    /**
     * The same step, with the model's text handed to {@code sink} as it's written, and stopped as
     * soon as {@code sink.stopped()} says so (the provider's stream is closed, so it stops
     * generating). A provider that can't stream answers in one piece, handed over at the end.
     */
    default Turn stream(String system, List<Msg> messages, List<ToolCatalog.Tool> tools, boolean allowCalls, int maxTokens, Sink sink) {
        if (sink.stopped()) throw new Stopped();
        Turn t = next(system, messages, tools, allowCalls, maxTokens);
        if (sink.stopped()) throw new Stopped();
        if (t.text() != null && !t.text().isEmpty()) sink.text(t.text());
        return t;
    }

    /** Where a streamed step's text goes as it arrives, and whether the person stopped the question. */
    interface Sink {
        /** More of the model's text (any size, possibly in the middle of a word or a JSON escape). */
        void text(String delta);

        /** True once the person stopped the question (or went away): nothing more is read. */
        boolean stopped();

        /** Discards the text and never stops: for the requests nobody watches. */
        Sink NONE = new Sink() {
            @Override
            public void text(String delta) {}

            @Override
            public boolean stopped() {
                return false;
            }
        };
    }

    /**
     * The person stopped the question while the model was working. Whatever the provider had
     * generated is discarded; nothing was changed.
     */
    class Stopped extends AiClient.AiClientException {
        public Stopped() {
            super("stopped by the person who asked", null);
        }
    }

    /** A tool call the model asked for. {@code arguments} is always a JSON object (empty when it sent none or nonsense). */
    record Call(String id, String name, JsonNode arguments) {}

    /** The model's turn: text (possibly empty), the calls it asked for, and the tokens it used. */
    record Turn(String text, List<Call> calls, long tokens) {}

    sealed interface Msg permits UserMsg, AssistantMsg, ToolMsg {}

    record UserMsg(String text) implements Msg {}

    record AssistantMsg(String text, List<Call> calls) implements Msg {}

    record ToolMsg(String callId, String name, String content) implements Msg {}

    /**
     * The provider refused the request because of the tools (the model or service doesn't support
     * function calling). Nothing was generated or paid for; the caller asks again without tools.
     */
    class ToolsUnsupported extends AiClient.AiClientException {
        public ToolsUnsupported(String message) {
            super(message, null);
        }
    }

    /**
     * Whether a refused first request was refused because of the tools: a bad request, not found or
     * unprocessable, whose message is about tools or functions ("model X does not support tools",
     * "tool calling is not supported"). Other refusals (a wrong model name, a request too long) are
     * ordinary failures, so one of them can't switch tools off.
     */
    static boolean refusesTools(int status, String body) {
        if (status != 400 && status != 404 && status != 422) return false;
        String b = body == null ? "" : body.toLowerCase(java.util.Locale.ROOT);
        return b.contains("tool") || b.contains("function");
    }
}
