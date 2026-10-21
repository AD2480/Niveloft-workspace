package dev.projectflow.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.projectflow.config.AppProperties;
import java.util.List;
import org.junit.jupiter.api.Test;

/** Choosing a local model and the right client, without a running Ollama. */
class OllamaClientTest {

    @Test
    void picksAGoodChatModelAndSkipsEmbeddings() {
        assertThat(OllamaClient.pick(List.of("nomic-embed-text:latest", "mistral:7b", "llama3.2:latest"), null)).isEqualTo("llama3.2:latest");
        assertThat(OllamaClient.pick(List.of("bge-embed", "tinyllama:1b"), null)).isEqualTo("tinyllama:1b");
        assertThat(OllamaClient.pick(List.of("nomic-embed-text"), null)).isNull();
    }

    @Test
    void respectsTheChosenModelAndNeverSwapsItSilently() {
        assertThat(OllamaClient.pick(List.of("llama3.2:latest", "qwen2.5:3b"), "qwen2.5:3b")).isEqualTo("qwen2.5:3b");
        assertThat(OllamaClient.pick(List.of("llama3.2:latest"), "llama3.2")).isEqualTo("llama3.2:latest");
        assertThat(OllamaClient.pick(List.of("llama3.2:latest"), "gemma3")).isNull();
    }

    @Test
    void usesOllamasOwnApiAtItsAddress() {
        assertThat(OllamaClient.root("http://localhost:11434/v1/")).isEqualTo("http://localhost:11434");
        ObjectMapper json = new ObjectMapper();
        assertThat(AiClients.create(new AppProperties.Ai("openai", "", "llama3.2", "http://localhost:11434/v1", 30), json)).isInstanceOf(OllamaClient.class);
        assertThat(AiClients.create(new AppProperties.Ai("openai", "gsk", "m", "https://api.groq.com/openai/v1", 30), json)).isInstanceOf(OpenAiCompatibleClient.class);
        assertThat(AiClients.create(new AppProperties.Ai("auto", "", "", "", 30), json)).isNull();
    }

    @Test
    void autoLooksOnThisComputerAndTheDockerHost() {
        assertThat(new AppProperties.Ai("", "", "", "", 30).providerName()).isEqualTo("auto");
        assertThat(AiClients.ollamaAddresses(new AppProperties.Ai("auto", "", "", "", 30)))
                .containsExactly("http://localhost:11434", "http://host.docker.internal:11434");
        assertThat(AiClients.ollamaAddresses(new AppProperties.Ai("ollama", "", "", "http://gpu-box:11434", 30))).containsExactly("http://gpu-box:11434");
    }
}
