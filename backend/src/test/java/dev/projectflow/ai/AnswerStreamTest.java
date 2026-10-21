package dev.projectflow.ai;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The answer's words picked out of a JSON reply while it's written, however the reply is split. */
class AnswerStreamTest {

    private static final String REPLY = "```json\n{\"citedTasks\":[\"ONB-9\"], \"answer\": \"ONB-9 is \\\"in review\\\" since Mon.\\nAsk Ben \\u00e9 \\ud83d\\ude00 done \\\\ ok\\/x\", \"notInRecords\": []}\n```";
    private static final String WORDS = "ONB-9 is \"in review\" since Mon.\nAsk Ben é 😀 done \\ ok/x";

    @Test
    void sameWordsWhereverTheReplyIsSplit() {
        for (int i = 0; i <= REPLY.length(); i++) {
            for (int j = i; j <= REPLY.length(); j += 5) {
                AnswerStream s = new AnswerStream();
                String got = s.accept(REPLY.substring(0, i)) + s.accept(REPLY.substring(i, j)) + s.accept(REPLY.substring(j));
                assertThat(got).as("split at %d and %d", i, j).isEqualTo(WORDS);
            }
        }
    }

    @Test
    void oneCharacterAtATimeNeverSplitsAnEmoji() {
        AnswerStream s = new AnswerStream();
        List<String> pieces = new ArrayList<>();
        for (char c : REPLY.toCharArray()) pieces.add(s.accept(String.valueOf(c)));
        assertThat(String.join("", pieces)).isEqualTo(WORDS);
        assertThat(pieces).noneMatch(p -> !p.isEmpty() && Character.isHighSurrogate(p.charAt(p.length() - 1)));
        assertThat(s.finished()).isTrue();
        assertThat(s.accept("\"answer\": \"more\"")).isEmpty();
    }

    @Test
    void skipsThinkingAndProseAndStartsOverAfterAReset() {
        AnswerStream s = new AnswerStream();
        String t = s.accept("<think>maybe {\"answer\": \"guess") + s.accept("\"}</think>{\"answer\":\"The real") + s.accept(" one\"}");
        assertThat(t).isEqualTo("The real one");
        AnswerStream prose = new AnswerStream();
        assertThat(prose.accept("I'll look that up.") + prose.accept(" One moment.")).isEmpty();
        prose.reset();
        assertThat(prose.accept("{\"Answer\" : \"Yes\"}")).isEqualTo("Yes");
        assertThat(new AnswerStream().accept("{\"answer\":\"line one\nline two\"}")).isEqualTo("line one\nline two");
    }
}
