package dev.projectflow.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.projectflow.web.dto.Dto;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Flurry's "Plan a project": the draft the AI returns is checked on the server before anyone sees it. */
class AiPlanTest {

    private final ObjectMapper json = new ObjectMapper();

    @Test
    void keepsOnlyPeopleInTheProjectRealDatesAndEarlierDependencies() throws Exception {
        var reply = json.readTree("""
                [
                  {"title":"Write the onboarding copy","priority":"high","dueDate":"2026-10-09","assigneeName":"priya nair","estimateDays":3,"dependsOn":[]},
                  {"title":"Build the welcome screens","priority":"URGENT-ish","dueDate":"next Friday","assigneeName":"Someone Else","estimateDays":99,"dependsOn":[0,0,1,7,-1]},
                  {"title":"   ","priority":"LOW"},
                  {"title":"Test with five new users","description":"Recruit from the beta list.","dependsOn":[1]}
                ]
                """);
        List<Dto.AiPlanTask> out = AiService.planTasks(reply, List.of("Priya Nair", "Rohan Mehta"));
        assertThat(out).extracting(Dto.AiPlanTask::title).containsExactly("Write the onboarding copy", "Build the welcome screens", "Test with five new users");

        Dto.AiPlanTask first = out.get(0);
        assertThat(first.priority()).isEqualTo("HIGH");
        assertThat(first.dueDate()).isEqualTo(LocalDate.of(2026, 10, 9));
        assertThat(first.assigneeName()).isEqualTo("Priya Nair"); // matched to the person's real name
        assertThat(first.estimateDays()).isEqualTo(3);

        Dto.AiPlanTask second = out.get(1);
        assertThat(second.priority()).isNull(); // unknown priority
        assertThat(second.dueDate()).isNull(); // not a date: never guessed
        assertThat(second.assigneeName()).isNull(); // not in the project
        assertThat(second.estimateDays()).isNull(); // out of range
        assertThat(second.dependsOn()).containsExactly(0); // only earlier tasks, once each

        assertThat(out.get(2).description()).isEqualTo("Recruit from the beta list.");
        assertThat(out.get(2).dependsOn()).containsExactly(1);
    }

    @Test
    void capsThePlanAndSurvivesGarbage() throws Exception {
        StringBuilder many = new StringBuilder("[");
        for (int i = 0; i < 30; i++) many.append(i == 0 ? "" : ",").append("{\"title\":\"Task ").append(i).append("\"}");
        many.append("]");
        assertThat(AiService.planTasks(json.readTree(many.toString()), List.of())).hasSize(AiService.MAX_PLAN_TASKS);
        assertThat(AiService.planTasks(json.readTree("{\"title\":\"not a list\"}"), List.of())).isEmpty();
        assertThat(AiService.planTasks(null, List.of())).isEmpty();
    }
}
