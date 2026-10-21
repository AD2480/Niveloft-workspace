package dev.projectflow.ai;

import dev.projectflow.web.dto.Dto;
import java.util.ArrayList;
import java.util.List;

/**
 * The look-things-up loop: the model asks for tool calls, the runner answers them from the
 * records, and the model goes on until it answers. Bounded on both sides: at most
 * {@code maxCalls} lookups and {@link #MAX_ROUNDS} model turns, after which the model is asked to
 * answer with what it has. No Spring and no I/O here, so it's tested with a scripted model.
 */
final class ToolLoop {

    /** Model turns, including the last one that must answer. */
    static final int MAX_ROUNDS = 5;

    /** Records linked from one lookup, at most. */
    static final int MAX_REFS = 30;

    private ToolLoop() {}

    /**
     * How a lookup went. NOTHING and UNAVAILABLE are different answers: the first means the records
     * were read and show nothing (which still isn't proof that nothing happened), the second that
     * they couldn't be read, so nothing is known.
     */
    enum Result {
        /** Records were found (or, for a suggestion, it was noted for the person to review). */
        FOUND,
        /** The lookup ran and the records show nothing matching. */
        NOTHING,
        /** The lookup couldn't be done (a failure, or a tool that doesn't exist): unknown, not "no". */
        UNAVAILABLE,
        /** A suggestion that wasn't noted (not valid, or over the limit). */
        DECLINED
    }

    /**
     * What a lookup produced: the text the model reads, a line for the person, how it went, and the
     * records it read (for links in "How I found this").
     */
    record Ran(String content, String label, Result result, List<Dto.AiRef> refs) {
        Ran {
            refs = refs == null ? List.of() : List.copyOf(refs.subList(0, Math.min(refs.size(), MAX_REFS)));
        }

        Ran(String content, String label, Result result) {
            this(content, label, result, List.of());
        }

        Ran(String content, String label, boolean found) {
            this(content, label, found ? Result.FOUND : Result.NOTHING, List.of());
        }

        Ran(String content, String label, boolean found, List<Dto.AiRef> refs) {
            this(content, label, found ? Result.FOUND : Result.NOTHING, refs);
        }

        boolean found() {
            return result == Result.FOUND;
        }
    }

    interface Runner {
        Ran run(ToolChat.Call call);
    }

    /** A lookup that was made (or refused), for the answer's "How I found this", with the records it read. */
    record Done(ToolChat.Call call, String label, Result result, List<Dto.AiRef> refs) {}

    /**
     * @param limited the model had to answer because it reached the lookup or round limit, so it
     *                answered with what it had found
     * @param stopped the person stopped the question: there is no answer, and {@code tokens} is
     *                what the provider used until then (estimated for the turn it was stopped in)
     */
    record Outcome(String text, List<Done> done, long tokens, int rounds, boolean limited, boolean stopped) {
        Outcome(String text, List<Done> done, long tokens, int rounds, boolean limited) {
            this(text, done, tokens, rounds, limited, false);
        }
    }

    /**
     * What a question shows while it's being answered (the model's text as it's written, each
     * lookup once it's made), and whether the person stopped it.
     */
    interface Listener extends ToolChat.Sink {
        /** A lookup was made (or refused). */
        default void lookup(Done done) {}

        /** The model went on to look things up, so the text it wrote in that turn wasn't the answer. */
        default void reset() {}

        /** Nobody is watching: the model's turns aren't streamed, and nothing stops them. */
        Listener NONE = new Listener() {
            @Override
            public void text(String delta) {}

            @Override
            public boolean stopped() {
                return false;
            }
        };
    }

    static Outcome run(ToolChat model, String system, String user, List<ToolCatalog.Tool> tools, Runner runner, int maxCalls, int maxTokens) {
        return run(model, system, user, tools, runner, maxCalls, maxTokens, Listener.NONE);
    }

    /**
     * As above, telling {@code listener} what happens as it happens. The model's turns are streamed
     * (unless nobody listens), and the person can stop the question between and during them: the
     * outcome then says so, with no text.
     */
    static Outcome run(ToolChat model, String system, String user, List<ToolCatalog.Tool> tools, Runner runner, int maxCalls, int maxTokens, Listener listener) {
        List<ToolChat.Msg> messages = new ArrayList<>();
        messages.add(new ToolChat.UserMsg(user));
        List<Done> done = new ArrayList<>();
        long tokens = 0;
        int rounds = 0;
        while (true) {
            if (listener.stopped()) return new Outcome("", done, tokens, rounds, false, true);
            boolean allow = done.size() < maxCalls && rounds < MAX_ROUNDS - 1;
            ToolChat.Turn turn;
            if (listener == Listener.NONE) {
                turn = model.next(system, messages, tools, allow, maxTokens);
            } else {
                StringBuilder written = new StringBuilder();
                try {
                    turn = model.stream(system, messages, tools, allow, maxTokens, new ToolChat.Sink() {
                        @Override
                        public void text(String delta) {
                            written.append(delta);
                            listener.text(delta);
                        }

                        @Override
                        public boolean stopped() {
                            return listener.stopped();
                        }
                    });
                } catch (ToolChat.Stopped e) {
                    // The provider read the conversation and wrote some of a reply before it was stopped: that counts.
                    return new Outcome("", done, tokens + OpenAiCompatibleClient.estimate(system, messages, written.toString()), rounds + 1, false, true);
                }
            }
            rounds++;
            tokens += turn.tokens();
            // An answer, or the last turn (if the model still asks for lookups, its text is all there is).
            if (turn.calls().isEmpty() || !allow) return new Outcome(turn.text() == null ? "" : turn.text(), done, tokens, rounds, !allow);
            listener.reset();
            messages.add(new ToolChat.AssistantMsg(turn.text(), turn.calls()));
            for (ToolChat.Call call : turn.calls()) {
                // Every call gets a reply (providers expect one per call); past the limit it says so.
                if (done.size() >= maxCalls) {
                    messages.add(new ToolChat.ToolMsg(call.id(), call.name(), "Not looked up: the limit of " + maxCalls + " lookups was reached. Answer with what you have."));
                    continue;
                }
                if (listener.stopped()) return new Outcome("", done, tokens, rounds, false, true);
                Ran ran = runner.run(call);
                Done d = new Done(call, ran.label(), ran.result(), ran.refs());
                done.add(d);
                listener.lookup(d);
                messages.add(new ToolChat.ToolMsg(call.id(), call.name(), ran.content()));
            }
        }
    }
}
