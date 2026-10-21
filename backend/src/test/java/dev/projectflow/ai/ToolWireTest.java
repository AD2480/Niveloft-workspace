package dev.projectflow.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Each provider's wire format for function calling, built and read without a network. */
class ToolWireTest {

    private final ObjectMapper json = new ObjectMapper();
    private final List<ToolCatalog.Tool> tools = ToolCatalog.load(json).all();

    private List<ToolChat.Msg> history() throws Exception {
        ToolChat.Call c1 = new ToolChat.Call("call_1", "get_task", json.readTree("{\"key\":\"ONB-9\"}"));
        ToolChat.Call c2 = new ToolChat.Call("call_2", "get_comments", json.readTree("{\"key\":\"ONB-9\"}"));
        return List.of(new ToolChat.UserMsg("Why is ONB-9 late?"), new ToolChat.AssistantMsg("", List.of(c1, c2)),
                new ToolChat.ToolMsg("call_1", "get_task", "ONB-9 | <record>Passkey API</record>"), new ToolChat.ToolMsg("call_2", "get_comments", "No comments."));
    }

    @Test
    void openAiFormat() throws Exception {
        ObjectNode body = OpenAiCompatibleClient.toolBody(json, "qwen3", "rules", history(), tools, true, 800);
        JsonNode messages = body.path("messages");
        assertThat(messages.get(0).path("role").asText()).isEqualTo("system");
        JsonNode assistant = messages.get(2);
        assertThat(assistant.path("content").isNull()).isTrue();
        // Arguments go as a JSON string, as the format requires.
        assertThat(assistant.path("tool_calls").get(0).path("function").path("arguments").asText()).isEqualTo("{\"key\":\"ONB-9\"}");
        assertThat(messages.get(3).path("role").asText()).isEqualTo("tool");
        assertThat(messages.get(3).path("tool_call_id").asText()).isEqualTo("call_1");
        assertThat(body.path("tools").get(0).path("type").asText()).isEqualTo("function");
        assertThat(body.path("tools").get(0).path("function").path("parameters").path("type").asText()).isEqualTo("object");
        assertThat(body.path("tool_choice").asText()).isEqualTo("auto");
        assertThat(OpenAiCompatibleClient.toolBody(json, "m", "s", history(), tools, false, 800).path("tool_choice").asText()).isEqualTo("none");

        JsonNode reply = json.readTree("""
                {"choices":[{"message":{"content":null,"tool_calls":[
                  {"id":"x1","type":"function","function":{"name":"find_tasks","arguments":"{\\"query\\":\\"passkey\\"}"}},
                  {"id":"x2","type":"function","function":{"name":"get_task","arguments":"not json"}}]}}],
                 "usage":{"total_tokens":321}}
                """);
        ToolChat.Turn turn = OpenAiCompatibleClient.parseTurn(json, reply, "s", history());
        assertThat(turn.calls()).extracting(ToolChat.Call::name).containsExactly("find_tasks", "get_task");
        assertThat(turn.calls().get(0).arguments().path("query").asText()).isEqualTo("passkey");
        assertThat(turn.calls().get(1).arguments().size()).isZero(); // unreadable arguments become {}
        assertThat(turn.tokens()).isEqualTo(321);
    }

    @Test
    void ollamaFormat() throws Exception {
        ObjectNode body = OllamaClient.toolBody(json, "qwen3:8b", "rules", history(), tools, true, 800);
        JsonNode assistant = body.path("messages").get(2);
        // Ollama takes arguments as an object, and tool results by tool name.
        assertThat(assistant.path("tool_calls").get(0).path("function").path("arguments").path("key").asText()).isEqualTo("ONB-9");
        assertThat(body.path("messages").get(3).path("tool_name").asText()).isEqualTo("get_task");
        assertThat(body.has("tools")).isTrue();
        assertThat(body.has("format")).isFalse();
        // The answering turn offers no tools and asks for JSON.
        ObjectNode last = OllamaClient.toolBody(json, "qwen3:8b", "rules", history(), tools, false, 800);
        assertThat(last.has("tools")).isFalse();
        assertThat(last.path("format").asText()).isEqualTo("json");

        JsonNode reply = json.readTree("""
                {"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"recent_activity","arguments":{"days":3}}}]},
                 "prompt_eval_count":200,"eval_count":20}
                """);
        ToolChat.Turn turn = OllamaClient.parseTurn(json, reply, "s", history());
        assertThat(turn.calls()).hasSize(1);
        assertThat(turn.calls().get(0).id()).isEqualTo("call_1"); // Ollama sends no ids; they're made up in order
        assertThat(turn.calls().get(0).arguments().path("days").asInt()).isEqualTo(3);
        assertThat(turn.tokens()).isEqualTo(220);
    }

    @Test
    void anthropicFormat() throws Exception {
        ObjectNode body = AnthropicClient.toolBody(json, "claude", "rules", history(), tools, false, 800);
        JsonNode messages = body.path("messages");
        assertThat(body.path("system").asText()).isEqualTo("rules");
        assertThat(messages.get(1).path("content").get(0).path("type").asText()).isEqualTo("tool_use");
        assertThat(messages.get(1).path("content").get(0).path("input").path("key").asText()).isEqualTo("ONB-9");
        // Both results go back together, in one user turn.
        assertThat(messages).hasSize(3);
        assertThat(messages.get(2).path("role").asText()).isEqualTo("user");
        assertThat(messages.get(2).path("content")).hasSize(2);
        assertThat(messages.get(2).path("content").get(1).path("tool_use_id").asText()).isEqualTo("call_2");
        assertThat(body.path("tools").get(0).has("input_schema")).isTrue();
        assertThat(body.path("tool_choice").path("type").asText()).isEqualTo("none");

        JsonNode reply = json.readTree("""
                {"content":[{"type":"text","text":"Let me check."},{"type":"tool_use","id":"tu_1","name":"get_task","input":{"key":"ONB-10"}}],
                 "usage":{"input_tokens":90,"output_tokens":10}}
                """);
        ToolChat.Turn turn = AnthropicClient.parseTurn(reply, "s", history());
        assertThat(turn.text()).isEqualTo("Let me check.");
        assertThat(turn.calls().get(0).id()).isEqualTo("tu_1");
        assertThat(turn.calls().get(0).arguments().path("key").asText()).isEqualTo("ONB-10");
        assertThat(turn.tokens()).isEqualTo(100);
    }

    @Test
    void onlyARefusalAboutToolsSwitchesThemOff() {
        assertThat(ToolChat.refusesTools(400, "{\"error\":\"registry.ollama.ai/library/gemma:2b does not support tools\"}")).isTrue();
        assertThat(ToolChat.refusesTools(422, "Function calling is not supported for this model")).isTrue();
        // A wrong model name or a request that's too long is an ordinary failure.
        assertThat(ToolChat.refusesTools(400, "{\"error\":{\"message\":\"The model `x` does not exist\"}}")).isFalse();
        assertThat(ToolChat.refusesTools(500, "tool server error")).isFalse();
        assertThat(ToolChat.refusesTools(404, null)).isFalse();
    }

    @Test
    void theCatalogueIsWhatTheEvalReads() {
        ToolCatalog catalog = ToolCatalog.load(json);
        assertThat(catalog.all()).extracting(ToolCatalog.Tool::name)
                .containsExactly("find_tasks", "get_task", "get_comments", "find_mentions", "recent_activity", "search_documents", "propose_create_task", "propose_start_task");
        assertThat(catalog.all().stream().filter(t -> t.kind() == ToolCatalog.Kind.PROPOSAL)).extracting(ToolCatalog.Tool::name)
                .allMatch(n -> n.startsWith("propose_"));
        // Nothing in the catalogue can approve, assign, delete or reschedule.
        assertThat(catalog.all()).extracting(ToolCatalog.Tool::name).noneMatch(n -> n.matches(".*(approve|assign|delete|deadline|review).*"));
    }
}
