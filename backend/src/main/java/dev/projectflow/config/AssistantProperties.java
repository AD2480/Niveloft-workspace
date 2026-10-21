package dev.projectflow.config;

import java.util.Locale;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Flurry, the assistant: whether it may look things up with tools (function calling) when the
 * model supports them, how many lookups one question may make, and an optional natural voice for
 * reading answers aloud. Keys stay on the server.
 *
 * @param tools      auto (default): use tools when the AI provider and model support them; off: never
 * @param maxLookups lookups per question (1–10, default 6)
 * @param voice      the voice for "Read answers aloud"
 */
@ConfigurationProperties(prefix = "projectflow.assistant")
public record AssistantProperties(String tools, Integer maxLookups, Voice voice) {

    public boolean toolsOn() {
        String t = tools == null ? "" : tools.trim().toLowerCase(Locale.ROOT);
        return !(t.equals("off") || t.equals("false") || t.equals("none") || t.equals("disabled"));
    }

    public int lookups() {
        return maxLookups == null ? 6 : Math.min(10, Math.max(1, maxLookups));
    }

    public Voice voiceOrNone() {
        return voice == null ? new Voice(null, null, null, null, null) : voice;
    }

    /**
     * @param provider            none (default: the browser's own voice) or elevenlabs
     * @param apiKey              the ElevenLabs key, server-side only
     * @param voiceId             which ElevenLabs voice reads the answers
     * @param model               the ElevenLabs model (default eleven_multilingual_v2)
     * @param maxCharactersPerDay the server's daily budget of characters read aloud (0 = no cap)
     */
    public record Voice(String provider, String apiKey, String voiceId, String model, Integer maxCharactersPerDay) {

        public String providerName() {
            String p = provider == null ? "" : provider.trim().toLowerCase(Locale.ROOT);
            return p.isEmpty() ? "none" : p;
        }

        /** ElevenLabs with what it needs (a key and a voice). */
        public boolean configured() {
            return providerName().equals("elevenlabs") && apiKey != null && !apiKey.isBlank() && voiceId != null && !voiceId.isBlank();
        }

        public String modelOrDefault() {
            return model == null || model.isBlank() ? "eleven_multilingual_v2" : model.trim();
        }

        public int charactersPerDay() {
            return maxCharactersPerDay == null ? 20000 : Math.max(0, maxCharactersPerDay);
        }
    }
}
