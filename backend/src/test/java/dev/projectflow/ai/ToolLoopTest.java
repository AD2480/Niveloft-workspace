package dev.projectflow.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The look-things-up loop, with a scripted model: it answers, it's bounded, and every call gets a reply. */
class ToolLoopTest {

    private final ObjectMapper json = new ObjectMapper();
    private final List<ToolCatalog.Tool> tools = ToolCatalog.load(json).all();

    /** A model that plays back turns, and records what it was sent each time. */
    private static final class Scripted implements ToolChat {
        final List<Turn> turns;
        final List<List<Msg>> seen = new ArrayList<>();
        final List<Boolean> allowed = new ArrayList<>();

        Scripted(Turn... turns) {
            this.turns = List.of(turns);
        }

        @Override
        public Turn next(String system, List<Msg> messages, List<ToolCatalog.Tool> tools, boolean allowCalls, int maxTokens) {
            seen.add(List.copyOf(messages));
            allowed.add(allowCalls);
            return turns.get(Math.min(seen.size() - 1, turns.size() - 1));
        }
    }

    private ToolChat.Call call(String id, String name, String args) throws Exception {
        return new ToolChat.Call(id, name, json.readTree(args));
    }

    @Test
    void looksUpThenAnswers() throws Exception {
        Scripted model = new Scripted(
                new ToolChat.Turn("", List.of(call("c1", "get_task", "{\"key\":\"ONB-9\"}")), 100),
                new ToolChat.Turn("{\"answer\":\"ONB-9 waits on review.\"}", List.of(), 50));
        ToolLoop.Outcome out = ToolLoop.run(model, "system", "question", tools, c -> new ToolLoop.Ran("ONB-9 | <record>Passkey API</record>", "Read ONB-9", true), 6, 800);
        assertThat(out.text()).contains("waits on review");
        assertThat(out.rounds()).isEqualTo(2);
        assertThat(out.tokens()).isEqualTo(150);
        assertThat(out.done()).extracting(ToolLoop.Done::label).containsExactly("Read ONB-9");
        assertThat(out.limited()).isFalse();
        // The second turn saw the question, the call and its result, in that order.
        List<ToolChat.Msg> second = model.seen.get(1);
        assertThat(second).hasSize(3);
        assertThat(second.get(1)).isInstanceOf(ToolChat.AssistantMsg.class);
        assertThat(((ToolChat.ToolMsg) second.get(2)).callId()).isEqualTo("c1");
    }

    @Test
    void stopsAtTheLookupLimitAndStillRepliesToEveryCall() throws Exception {
        ToolChat.Turn threeCalls = new ToolChat.Turn("", List.of(call("a", "find_tasks", "{}"), call("b", "find_tasks", "{}"), call("c", "find_tasks", "{}")), 10);
        Scripted model = new Scripted(threeCalls, threeCalls, new ToolChat.Turn("{\"answer\":\"done\"}", List.of(), 10));
        List<String> ran = new ArrayList<>();
        ToolLoop.Outcome out = ToolLoop.run(model, "s", "q", tools, c -> {
            ran.add(c.id());
            return new ToolLoop.Ran("ok", "Listed tasks", true);
        }, 4, 800);
        assertThat(ran).hasSize(4);
        assertThat(out.done()).hasSize(4);
        // The fifth and sixth calls were answered with "not looked up", so the conversation stays valid.
        List<ToolChat.Msg> third = model.seen.get(2);
        assertThat(third.stream().filter(m -> m instanceof ToolChat.ToolMsg t && t.content().startsWith("Not looked up")).count()).isEqualTo(2);
        // Once the limit is reached, the model is told to answer.
        assertThat(model.allowed).containsExactly(true, true, false);
        assertThat(out.limited()).isTrue(); // the answer says it had to stop looking
        assertThat(out.text()).contains("done");
    }

    @Test
    void endsAfterTheLastRoundEvenIfTheModelKeepsAsking() throws Exception {
        ToolChat.Turn ask = new ToolChat.Turn("", List.of(call("x", "get_task", "{\"key\":\"ONB-1\"}")), 1);
        Scripted model = new Scripted(ask);
        ToolLoop.Outcome out = ToolLoop.run(model, "s", "q", tools, c -> new ToolLoop.Ran("ok", "Read ONB-1", true), 50, 800);
        assertThat(out.rounds()).isEqualTo(ToolLoop.MAX_ROUNDS);
        assertThat(out.limited()).isTrue();
        assertThat(model.allowed.get(model.allowed.size() - 1)).isFalse();
        assertThat(out.text()).isEmpty(); // the caller says it kept looking things up without answering
    }

    /** Records what a streamed question shows, and stops after so many lookups. */
    private static final class Events implements ToolLoop.Listener {
        final List<String> seen = new ArrayList<>();
        int stopAfterLookups = -1;

        @Override
        public void text(String delta) {
            seen.add("text:" + delta);
        }

        @Override
        public boolean stopped() {
            return stopAfterLookups >= 0 && seen.stream().filter(s -> s.startsWith("lookup:")).count() >= stopAfterLookups;
        }

        @Override
        public void lookup(ToolLoop.Done done) {
            seen.add("lookup:" + done.label());
        }

        @Override
        public void reset() {
            seen.add("reset");
        }
    }

    @Test
    void tellsTheListenerAsItGoes() throws Exception {
        Scripted model = new Scripted(new ToolChat.Turn("Let me look.", List.of(call("c1", "get_task", "{\"key\":\"ONB-9\"}")), 100),
                new ToolChat.Turn("{\"answer\":\"Waiting on review.\"}", List.of(), 50));
        Events ev = new Events();
        ToolLoop.Outcome out = ToolLoop.run(model, "s", "q", tools, c -> new ToolLoop.Ran("ok", "Read " + c.name(), true), 6, 800, ev);
        // The text before a lookup wasn't the answer: it's cleared.
        assertThat(ev.seen).containsExactly("text:Let me look.", "reset", "lookup:Read get_task", "text:{\"answer\":\"Waiting on review.\"}");
        assertThat(out.stopped()).isFalse();
        assertThat(out.tokens()).isEqualTo(150);
    }

    @Test
    void stopsBetweenLookupsAndCountsWhatWasUsed() throws Exception {
        Scripted model = new Scripted(new ToolChat.Turn("", List.of(call("c1", "get_task", "{}"), call("c2", "get_comments", "{}")), 100),
                new ToolChat.Turn("{\"answer\":\"x\"}", List.of(), 50));
        Events ev = new Events();
        ev.stopAfterLookups = 1;
        List<String> ran = new ArrayList<>();
        ToolLoop.Outcome out = ToolLoop.run(model, "s", "q", tools, c -> {
            ran.add(c.id());
            return new ToolLoop.Ran("ok", "Read", true);
        }, 6, 800, ev);
        assertThat(out.stopped()).isTrue();
        assertThat(out.text()).isEmpty();
        assertThat(ran).containsExactly("c1");
        assertThat(out.rounds()).isEqualTo(1);
        assertThat(out.tokens()).isEqualTo(100);
    }

    @Test
    void stoppedInTheMiddleOfATurnOrBeforeAnything() {
        ToolChat stopping = new ToolChat() {
            @Override
            public Turn next(String system, List<Msg> messages, List<ToolCatalog.Tool> t, boolean allowCalls, int maxTokens) {
                throw new AssertionError("not used");
            }

            @Override
            public Turn stream(String system, List<Msg> messages, List<ToolCatalog.Tool> t, boolean allowCalls, int maxTokens, Sink sink) {
                sink.text("{\"answer\": \"Half");
                throw new Stopped();
            }
        };
        ToolLoop.Outcome mid = ToolLoop.run(stopping, "a long system prompt", "a question", tools, c -> null, 6, 800, new Events());
        assertThat(mid.stopped()).isTrue();
        assertThat(mid.rounds()).isEqualTo(1);
        assertThat(mid.tokens()).isPositive(); // the provider read the conversation: estimated
        Events before = new Events();
        before.stopAfterLookups = 0;
        ToolLoop.Outcome none = ToolLoop.run(new Scripted(new ToolChat.Turn("x", List.of(), 1)), "s", "q", tools, c -> null, 6, 800, before);
        assertThat(none.stopped()).isTrue();
        assertThat(none.rounds()).isZero();
        assertThat(none.tokens()).isZero();
    }

    @Test
    void withoutAListenerNothingIsStreamed() {
        ToolChat model = new ToolChat() {
            @Override
            public Turn next(String system, List<Msg> messages, List<ToolCatalog.Tool> t, boolean allowCalls, int maxTokens) {
                return new Turn("{\"answer\":\"ok\"}", List.of(), 3);
            }

            @Override
            public Turn stream(String system, List<Msg> messages, List<ToolCatalog.Tool> t, boolean allowCalls, int maxTokens, Sink sink) {
                throw new AssertionError("streamed without a listener");
            }
        };
        assertThat(ToolLoop.run(model, "s", "q", tools, c -> null, 6, 800).text()).contains("ok");
    }
}
