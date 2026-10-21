package dev.projectflow.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The three providers' streamed replies with the real JDK HTTP client against a local stand-in:
 * put back together, passed on before the reply ends, stopped at once (closing the connection so
 * the provider stops generating), and timed out when the provider goes quiet.
 */
class StreamingClientsTest {

    private final ObjectMapper json = new ObjectMapper();
    private final List<ToolCatalog.Tool> tools = ToolCatalog.load(json).all();
    private final List<ToolChat.Msg> first = List.of(new ToolChat.UserMsg("What is ONB-9 waiting on?"));
    private HttpServer server;
    private final Map<String, String> bodies = new ConcurrentHashMap<>();
    private final AtomicLong lastLineWritten = new AtomicLong();
    private final AtomicBoolean clientGone = new AtomicBoolean();

    /** Records what a streamed step passes on; can stop after the first words. */
    private static final class Rec implements ToolChat.Sink {
        final StringBuilder text = new StringBuilder();
        final List<Long> when = new ArrayList<>();
        volatile boolean stop;
        volatile long stoppedAt;
        boolean stopOnFirstWords;

        @Override
        public synchronized void text(String delta) {
            text.append(delta);
            when.add(System.nanoTime());
            if (stopOnFirstWords && !stop) {
                stoppedAt = System.nanoTime();
                stop = true;
            }
        }

        @Override
        public boolean stopped() {
            return stop;
        }
    }

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newCachedThreadPool());
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private String base() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void stream(String path, String type, List<String> lines, long pauseMs) {
        server.createContext(path, ex -> {
            bodies.put(path, new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            ex.getResponseHeaders().add("content-type", type);
            ex.sendResponseHeaders(200, 0);
            try (OutputStream out = ex.getResponseBody()) {
                for (String l : lines) {
                    out.write((l + "\n").getBytes(StandardCharsets.UTF_8));
                    out.flush();
                    lastLineWritten.set(System.nanoTime());
                    sleep(pauseMs);
                }
            } catch (IOException e) {
                clientGone.set(true);
            }
        });
    }

    private void status(String path, int status, String body) {
        server.createContext(path, ex -> {
            ex.getRequestBody().readAllBytes();
            byte[] b = body.getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(status, b.length);
            try (OutputStream out = ex.getResponseBody()) {
                out.write(b);
            }
        });
    }

    @Test
    void openAiCompatibleTextArrivesBeforeTheReplyEnds() throws Exception {
        stream("/v1/chat/completions", "text/event-stream", List.of(
                "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"answer\\\": \\\"ONB-9 \"}}]}", "",
                "data: {\"choices\":[{\"delta\":{\"content\":\"waits on review.\\\"}\"}}]}", "",
                "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"total_tokens\":99}}", "",
                "data: [DONE]", ""), 60);
        Rec rec = new Rec();
        ToolChat.Turn turn = new OpenAiCompatibleClient(json, base() + "/v1", "secret", "m").stream("sys", first, tools, true, 300, rec);
        assertThat(turn.text()).isEqualTo("{\"answer\": \"ONB-9 waits on review.\"}");
        assertThat(turn.tokens()).isEqualTo(99);
        assertThat(rec.when.get(0)).isLessThan(lastLineWritten.get());
        assertThat(json.readTree(bodies.get("/v1/chat/completions")).path("stream").asBoolean()).isTrue();
    }

    @Test
    void openAiToolCallsArePutBackTogether() throws Exception {
        OpenAiCompatibleClient.StreamReader r = new OpenAiCompatibleClient.StreamReader(json, ToolChat.Sink.NONE);
        for (String l : List.of(
                "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"get_task\",\"arguments\":\"\"}}]}}]}",
                ": keep-alive",
                "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"key\\\":\"}}]}}]}",
                "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"ONB-9\\\"}\"}}]}}]}",
                "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}],\"x_groq\":{\"usage\":{\"total_tokens\":77}}}",
                "data: [DONE]")) r.line(l);
        ToolChat.Turn turn = r.turn("s", first);
        assertThat(turn.calls()).singleElement().satisfies(c -> {
            assertThat(c.name()).isEqualTo("get_task");
            assertThat(c.arguments().path("key").asText()).isEqualTo("ONB-9");
        });
        assertThat(turn.tokens()).isEqualTo(77);
    }

    @Test
    void anthropicAndOllamaStreams() throws Exception {
        stream("/v1/messages", "text/event-stream", List.of(
                "event: message_start", "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10,\"output_tokens\":1}}}", "",
                "event: content_block_start", "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"get_comments\",\"input\":{}}}", "",
                "event: content_block_delta", "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"key\\\":\\\"ONB-9\\\"}\"}}", "",
                "event: message_delta", "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":5}}", "",
                "event: message_stop", "data: {\"type\":\"message_stop\"}", ""), 20);
        ToolChat.Turn a = new AnthropicClient(json, base(), "secret", "claude").stream("sys", first, tools, true, 300, new Rec());
        assertThat(a.calls()).singleElement().satisfies(c -> assertThat(c.arguments().path("key").asText()).isEqualTo("ONB-9"));
        assertThat(a.tokens()).isEqualTo(15);

        stream("/api/chat", "application/x-ndjson", List.of(
                "{\"message\":{\"content\":\"\",\"thinking\":\"hmm\"},\"done\":false}",
                "{\"message\":{\"content\":\"{\\\"answer\\\":\\\"Hi\"},\"done\":false}",
                "{\"message\":{\"content\":\"!\\\"}\"},\"done\":false}",
                "{\"message\":{\"content\":\"\"},\"done\":true,\"prompt_eval_count\":3,\"eval_count\":4}"), 20);
        Rec rec = new Rec();
        ToolChat.Turn o = new OllamaClient(json, base(), "llama3.2").stream("sys", first, List.of(), false, 300, rec);
        assertThat(o.text()).isEqualTo("{\"answer\":\"Hi!\"}");
        assertThat(o.tokens()).isEqualTo(7);
        assertThat(rec.text.toString()).isEqualTo(o.text()); // the thinking isn't passed on
    }

    @Test
    void aRefusalOfTheToolsIsToldApartFromOtherFailures() {
        status("/refuse/v1/chat/completions", 400, "{\"error\":{\"message\":\"This model does not support tools\"}}");
        status("/broken/v1/chat/completions", 503, "{\"error\":\"busy\"}");
        assertThatThrownBy(() -> new OpenAiCompatibleClient(json, base() + "/refuse/v1", "", "m").stream("sys", first, tools, true, 300, new Rec()))
                .isInstanceOf(ToolChat.ToolsUnsupported.class);
        assertThatThrownBy(() -> new OpenAiCompatibleClient(json, base() + "/broken/v1", "", "m").stream("sys", first, tools, true, 300, new Rec()))
                .isInstanceOf(AiClient.AiClientException.class)
                .isNotInstanceOf(ToolChat.ToolsUnsupported.class)
                .hasMessageContaining("503");
    }

    @Test
    void aStopEndsTheRequestAtOnceAndClosesTheConnection() {
        server.createContext("/slow/v1/chat/completions", ex -> {
            ex.getRequestBody().readAllBytes();
            ex.getResponseHeaders().add("content-type", "text/event-stream");
            ex.sendResponseHeaders(200, 0);
            OutputStream out = ex.getResponseBody();
            try {
                out.write("data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"answer\\\": \\\"Partly\"}}]}\n\n".getBytes(StandardCharsets.UTF_8));
                out.flush();
                for (int i = 0; i < 100; i++) {
                    sleep(100);
                    out.write(": still here\n\n".getBytes(StandardCharsets.UTF_8));
                    out.flush();
                }
                out.close();
            } catch (IOException e) {
                clientGone.set(true);
            }
        });
        Rec rec = new Rec();
        rec.stopOnFirstWords = true;
        assertThatThrownBy(() -> new OpenAiCompatibleClient(json, base() + "/slow/v1", "", "m").stream("sys", first, tools, true, 300, rec))
                .isInstanceOf(ToolChat.Stopped.class);
        assertThat(Duration.ofNanos(System.nanoTime() - rec.stoppedAt)).isLessThan(Duration.ofSeconds(1));
        for (int i = 0; i < 40 && !clientGone.get(); i++) sleep(100);
        assertThat(clientGone).isTrue();
    }

    @Test
    void aQuietProviderTimesOutAndAStoppedQuestionSendsNothing() {
        server.createContext("/silent", ex -> {
            ex.getRequestBody().readAllBytes();
            ex.sendResponseHeaders(200, 0);
            sleep(3000);
            ex.close();
        });
        long start = System.nanoTime();
        assertThatThrownBy(() -> StreamedHttp.send(HttpClient.newHttpClient(),
                HttpRequest.newBuilder(URI.create(base() + "/silent")).POST(HttpRequest.BodyPublishers.ofString("{}")).build(),
                line -> {}, () -> false, Duration.ofMillis(500), Duration.ofSeconds(10)))
                .isInstanceOf(AiClient.AiClientException.class)
                .hasMessageContaining("sent nothing");
        assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofMillis(1500));

        Rec stopped = new Rec();
        stopped.stop = true;
        assertThatThrownBy(() -> new OpenAiCompatibleClient(json, base() + "/never/v1", "", "m").stream("sys", first, tools, true, 300, stopped))
                .isInstanceOf(ToolChat.Stopped.class);
        assertThat(bodies).doesNotContainKey("/never/v1/chat/completions");
    }
}
