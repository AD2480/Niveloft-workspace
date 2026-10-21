package dev.projectflow.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.projectflow.config.AppProperties;
import java.util.ArrayList;
import java.util.List;

/** Chooses the AI client for the configured provider. No Spring here, so it's easy to test. */
final class AiClients {

    private AiClients() {}

    /**
     * The client for an explicitly chosen provider, or null. anthropic: Anthropic's Messages API.
     * openai: any OpenAI-compatible chat API, including the free tiers of Groq and Gemini, and
     * OpenRouter. (auto and ollama are handled by {@link AiService}, which finds Ollama itself.)
     */
    static AiClient create(AppProperties.Ai config, ObjectMapper json) {
        if (!config.configured()) return null;
        String base = config.baseUrl() == null ? "" : config.baseUrl().trim();
        // Ollama's OpenAI-compatible address: use its own API instead, for JSON output and a big enough context.
        if (!config.providerName().equals("anthropic") && base.contains(":11434")) return new OllamaClient(json, base, config.model());
        return switch (config.providerName()) {
            case "anthropic" -> new AnthropicClient(json, base.isEmpty() ? "https://api.anthropic.com" : base, config.apiKey(), config.model());
            // An Anthropic address left over from an older setup means "not set" for an OpenAI-compatible provider.
            case "openai", "openai-compatible", "groq", "gemini", "openrouter" ->
                    new OpenAiCompatibleClient(json, base.isEmpty() || base.contains("anthropic.com") ? "https://api.openai.com/v1" : base, config.apiKey(), config.model());
            default -> null;
        };
    }

    /** Where to look for Ollama: the configured address first, then this computer, then the Docker host. */
    static List<String> ollamaAddresses(AppProperties.Ai config) {
        List<String> out = new ArrayList<>();
        String base = config.baseUrl() == null ? "" : config.baseUrl().trim();
        if (!base.isEmpty() && !base.contains("anthropic.com")) out.add(base);
        if (config.providerName().equals("auto") || base.isEmpty()) {
            out.add("http://localhost:11434");
            out.add("http://host.docker.internal:11434");
        }
        return out.stream().map(OllamaClient::root).distinct().toList();
    }
}
