package dev.projectflow.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

/**
 * The tool-calling eval (ml/) measures models with a copy of Flurry's instructions. This keeps the
 * copy the same as what the server sends, so the eval measures the real thing. Skipped when the
 * backend is built on its own, without the ml folder beside it.
 */
class AiInstructionsTest {

    @Test
    void theEvalUsesTheServersInstructions() throws Exception {
        Path copy = Path.of("..", "ml", "eval_cases", "flurry-instructions.txt");
        assumeTrue(Files.exists(copy), "ml/ isn't beside the backend here");
        assertThat(Files.readString(copy, StandardCharsets.UTF_8))
                .as("ml/eval_cases/flurry-instructions.txt is out of date: regenerate it from AiService.askInstructions(6)")
                .isEqualTo(AiService.askInstructions(6));
    }

    @Test
    void theInstructionsSayWhatFlurryMayNotDo() {
        String s = AiService.askInstructions(6);
        assertThat(s).contains("Never state that work is approved, assigned or rescheduled", "Never claim to have inspected them", "At most 6 lookups",
                "never turn it into a finding that something didn't happen", "never say it's done");
    }
}
