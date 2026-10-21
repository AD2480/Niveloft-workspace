package dev.projectflow.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.projectflow.config.AssistantProperties;
import dev.projectflow.web.error.ApiException;
import java.net.http.HttpRequest;
import java.time.Clock;
import org.junit.jupiter.api.Test;

/** The server voice: off unless fully set up, what it reads, and the request it makes. */
class VoiceServiceTest {

    private final ObjectMapper json = new ObjectMapper();

    @Test
    void offUnlessElevenLabsHasAKeyAndAVoice() {
        assertThat(new VoiceService(null, null, json, Clock.systemUTC(), "http://x").provider()).isNull();
        assertThat(new VoiceService(new AssistantProperties.Voice("elevenlabs", "", "v1", null, null), null, json, Clock.systemUTC(), "http://x").provider()).isNull();
        assertThat(new VoiceService(new AssistantProperties.Voice("elevenlabs", "key", "v1", null, null), null, json, Clock.systemUTC(), "http://x").provider()).isEqualTo("elevenlabs");
        assertThatThrownBy(() -> new VoiceService(null, null, json, Clock.systemUTC(), "http://x").speak(1L, "Hello")).isInstanceOf(ApiException.class);
    }

    @Test
    void readsWordsNotFormatting() {
        assertThat(VoiceService.speakable("**ONB-9** is `late`. See [the API](https://x.example).")).isEqualTo("ONB-9 is late. See the API.");
        String longer = "This sentence is fine. ".repeat(80);
        String cut = VoiceService.speakable(longer);
        assertThat(cut.length()).isLessThanOrEqualTo(VoiceService.MAX_TEXT);
        assertThat(cut).endsWith(".");
    }

    @Test
    void asksElevenLabsWithTheKeyOnTheServer() throws Exception {
        AssistantProperties.Voice v = new AssistantProperties.Voice("elevenlabs", " secret ", "voice 1", null, 0);
        HttpRequest req = VoiceService.request(json, "https://api.elevenlabs.io", v, "Hello");
        assertThat(req.uri().toString()).isEqualTo("https://api.elevenlabs.io/v1/text-to-speech/voice%201?output_format=mp3_44100_128");
        assertThat(req.headers().firstValue("xi-api-key")).contains("secret");
        assertThat(req.headers().firstValue("accept")).contains("audio/mpeg");
        assertThat(v.modelOrDefault()).isEqualTo("eleven_multilingual_v2");
        assertThat(v.charactersPerDay()).isZero();
    }
}
