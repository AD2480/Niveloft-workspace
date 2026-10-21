package dev.projectflow.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.projectflow.web.dto.Dto;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** What the assistant may propose is filtered on the server; nothing is ever applied there. */
class AiProposalsTest {

    private final ObjectMapper json = new ObjectMapper();

    @Test
    void keepsOnlyAllowedTypesAndRealTasks() throws Exception {
        var reply = json.readTree("""
                [
                  {"type":"START_TASK","taskKey":"lib-8"},
                  {"type":"START_TASK","taskKey":"LIB-99"},
                  {"type":"APPROVE_TASK","taskKey":"LIB-8"},
                  {"type":"CHANGE_DEADLINE","taskKey":"LIB-8","dueDate":"2026-12-01"},
                  {"type":"CREATE_TASK","title":"Fix the login bug","priority":"high","dueDate":"2026-10-02","assigneeName":"Priya Nair","estimateDays":2}
                ]
                """);
        List<Dto.AiProposal> out = AiService.proposals(reply, Set.of("LIB-8"));
        assertThat(out).extracting(Dto.AiProposal::type).containsExactly("START_TASK", "CREATE_TASK");
        assertThat(out.get(0).taskKey()).isEqualTo("LIB-8");
        Dto.AiProposal create = out.get(1);
        assertThat(create.title()).isEqualTo("Fix the login bug");
        assertThat(create.priority()).isEqualTo("HIGH");
        assertThat(create.dueDate()).isEqualTo(LocalDate.of(2026, 10, 2));
        assertThat(create.assigneeName()).isEqualTo("Priya Nair");
        assertThat(create.estimateDays()).isEqualTo(2);
    }

    @Test
    void dropsBadValuesInsteadOfGuessing() throws Exception {
        var reply = json.readTree("""
                [
                  {"type":"CREATE_TASK","title":"  "},
                  {"type":"CREATE_TASK","title":"Write notes","priority":"CRITICAL","dueDate":"next Friday","estimateDays":500},
                  {"type":"CREATE_TASK","title":"a"}, {"type":"CREATE_TASK","title":"b"}, {"type":"CREATE_TASK","title":"c"}
                ]
                """);
        List<Dto.AiProposal> out = AiService.proposals(reply, Set.of());
        assertThat(out).hasSize(3);
        assertThat(out.get(0).title()).isEqualTo("Write notes");
        assertThat(out.get(0).priority()).isNull();
        assertThat(out.get(0).dueDate()).isNull();
        assertThat(out.get(0).estimateDays()).isNull();
        assertThat(AiService.proposals(null, Set.of())).isEmpty();
    }
}
