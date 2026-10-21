package dev.projectflow.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Small models don't always reply with exactly one JSON object: they wrap it in prose or code
 * fences, repeat it, or add a note with braces after it. The first balanced object is the answer.
 */
class AiReplyJsonTest {

    @Test
    void findsTheFirstBalancedObjectAndIgnoresWhatFollows() {
        String reply = "Sure! ```json\n{\"answer\":\"CCP-2 is late.\",\"citedTasks\":[\"CCP-2\"]}\n``` Note: {see above}";
        List<String> found = AiService.jsonCandidates(reply);
        assertThat(found).first().isEqualTo("{\"answer\":\"CCP-2 is late.\",\"citedTasks\":[\"CCP-2\"]}");
        assertThat(found).hasSize(2);
    }

    @Test
    void ignoresBracesInsideStrings() {
        String reply = "{\"answer\":\"Use {curly} braces and a \\\"quote\\\" }\"} {\"answer\":\"second\"}";
        assertThat(AiService.jsonCandidates(reply)).containsExactly("{\"answer\":\"Use {curly} braces and a \\\"quote\\\" }\"}", "{\"answer\":\"second\"}");
    }

    @Test
    void handlesNestedObjectsAndUnfinishedOnes() {
        assertThat(AiService.jsonCandidates("{\"a\":{\"b\":1}}")).containsExactly("{\"a\":{\"b\":1}}");
        assertThat(AiService.jsonCandidates("{\"answer\":\"cut off")).isEmpty();
        assertThat(AiService.jsonCandidates("Hello! How can I help?")).isEmpty();
    }

    private final ObjectMapper json = new ObjectMapper();

    @Test
    void findsTheAnswerUnderOtherNamesNestedOrAsAList() throws Exception {
        assertThat(AiService.answerText(json.readTree("{\"answer\":\"ONB-9 is late.\"}"), 0)).isEqualTo("ONB-9 is late.");
        assertThat(AiService.answerText(json.readTree("{\"Answer\":\"Capitalised.\"}"), 0)).isEqualTo("Capitalised.");
        assertThat(AiService.answerText(json.readTree("{\"answer\":\"\",\"summary\":\"From the summary.\"}"), 0)).isEqualTo("From the summary.");
        assertThat(AiService.answerText(json.readTree("{\"answer\":{\"text\":\"Nested.\"}}"), 0)).isEqualTo("Nested.");
        assertThat(AiService.answerText(json.readTree("{\"answer\":[\"One.\",\"Two.\"]}"), 0)).isEqualTo("One. Two.");
        assertThat(AiService.answerText(json.readTree("{\"answer\":\"  \",\"citedTasks\":[]}"), 0)).isEmpty();
        assertThat(AiService.answerText(json.readTree("{\"answer\":{\"answer\":{\"text\":\"too deep\"}}}"), 0)).isEmpty();
    }

    @Test
    void mendsRawLineBreaksAndTrailingCommas() throws Exception {
        String broken = "{\"answer\":\"Line one\nline two\",\"citedTasks\":[\"ONB-1\",],}";
        String mended = AiService.repairJson(broken);
        assertThat(json.readTree(mended).path("answer").asText()).isEqualTo("Line one\nline two");
        assertThat(json.readTree(mended).path("citedTasks").size()).isEqualTo(1);
        assertThat(AiService.repairJson("{\"a\":\"x, }\"}")).isEqualTo("{\"a\":\"x, }\"}");
    }

    @Test
    void salvagesAnAnswerCutOffMidReply() {
        assertThat(AiService.cutOffAnswer("{\"answer\":\"ONB-9 is two days late and holds up ONB-10 and ONB-11, so the"))
                .isEqualTo("ONB-9 is two days late and holds up ONB-10 and ONB-11, so the");
        assertThat(AiService.cutOffAnswer("{\"answer\":\"A \\\"quoted\\\" word and a line\\nbreak, then cut \\u00")).isEqualTo("A \"quoted\" word and a line\nbreak, then cut");
        assertThat(AiService.cutOffAnswer("{\"answer\":\"too short")).isEmpty();
        assertThat(AiService.cutOffAnswer("no answer here at all, just words")).isEmpty();
    }
}
