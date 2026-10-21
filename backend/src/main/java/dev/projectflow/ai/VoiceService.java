package dev.projectflow.ai;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.projectflow.config.AssistantProperties;
import dev.projectflow.ops.UsageCounters;
import dev.projectflow.security.MemoryRateCounts;
import dev.projectflow.security.RateCounts;
import dev.projectflow.web.error.ApiException;
import dev.projectflow.web.error.ErrorCode;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

/**
 * A natural voice for Flurry's "Read answers aloud", through ElevenLabs' text-to-speech API. The
 * key stays here: the browser sends the answer's text to this server, which asks ElevenLabs and
 * returns the audio. Off unless VOICE_PROVIDER=elevenlabs with a key and a voice; then the
 * browser's own voice is the fallback whenever this one isn't available. Budgeted per person
 * per hour and for the whole server per day (characters), like the AI.
 */
@Service
public class VoiceService {

    private static final Logger log = LoggerFactory.getLogger(VoiceService.class);
    /** Characters read per request; an answer longer than this is cut at a sentence. */
    static final int MAX_TEXT = 1200;
    /** Requests per person per hour. */
    static final int PER_HOUR = 60;
    static final String COUNTER = "voice.characters";

    private final AssistantProperties.Voice config;
    private final UsageCounters spent;
    private final ObjectMapper json;
    private final Clock clock;
    private final String baseUrl;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    /** The per-person hourly limit's counts: shared by every API instance in production (RATE_LIMIT_STORE). */
    private final RateCounts hourly;
    private static final long HOUR_MS = 3_600_000;

    @Autowired
    public VoiceService(AssistantProperties props, UsageCounters spent, ObjectMapper json, Clock clock, RateCounts hourly) {
        this(props == null ? null : props.voiceOrNone(), spent, json, clock, "https://api.elevenlabs.io", hourly);
    }

    VoiceService(AssistantProperties.Voice config, UsageCounters spent, ObjectMapper json, Clock clock, String baseUrl) {
        this(config, spent, json, clock, baseUrl, new MemoryRateCounts(clock));
    }

    VoiceService(AssistantProperties.Voice config, UsageCounters spent, ObjectMapper json, Clock clock, String baseUrl, RateCounts hourly) {
        this.hourly = hourly;
        this.config = config == null ? new AssistantProperties.Voice(null, null, null, null, null) : config;
        this.spent = spent;
        this.json = json;
        this.clock = clock;
        this.baseUrl = baseUrl;
        if (this.config.providerName().equals("elevenlabs") && !this.config.configured()) {
            log.warn("VOICE_PROVIDER=elevenlabs needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID; answers are read by the browser's voice instead.");
        }
    }

    /** "elevenlabs" when the server can read answers aloud, else null (the browser's own voice). */
    public String provider() {
        return config.configured() ? "elevenlabs" : null;
    }

    /** The answer's text as MP3 audio. */
    public byte[] speak(Long userId, String text) {
        if (!config.configured()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.NOT_AVAILABLE, "No server voice is set up here, so answers are read by your browser’s voice.", null);
        }
        String clean = speakable(text);
        if (clean.isEmpty()) throw ApiException.validation("text", "There’s nothing to read aloud.");
        int cap = config.charactersPerDay();
        if (cap > 0 && spent != null && spent.get(COUNTER, spent.today()) + clean.length() > cap) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, ErrorCode.SPENDING_CAP, "Today’s budget for the server voice is used up, so your browser’s voice reads answers until midnight.", null);
        }
        Instant at = reserve(userId);
        try {
            HttpResponse<byte[]> res = http.send(request(json, baseUrl, config, clean), HttpResponse.BodyHandlers.ofByteArray());
            if (res.statusCode() / 100 != 2 || res.body() == null || res.body().length == 0) {
                throw new IllegalStateException("ElevenLabs returned HTTP " + res.statusCode());
            }
            if (spent != null) spent.add(COUNTER, spent.today(), clean.length());
            return res.body();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            refund(userId, at);
            throw failed(e);
        } catch (Exception e) {
            refund(userId, at); // nothing was spoken, so it doesn't count
            throw failed(e);
        }
    }

    private ApiException failed(Exception e) {
        log.warn("Voice: {}", e.getMessage());
        return new ApiException(HttpStatus.BAD_GATEWAY, ErrorCode.AI_FAILED, "The voice service didn’t answer, so your browser’s voice reads this one.", null);
    }

    /** ElevenLabs text-to-speech: POST /v1/text-to-speech/{voice_id}, the key in xi-api-key, MP3 back. */
    static HttpRequest request(ObjectMapper json, String baseUrl, AssistantProperties.Voice config, String text) throws Exception {
        ObjectNode body = json.createObjectNode();
        body.put("text", text);
        body.put("model_id", config.modelOrDefault());
        String voice = URLEncoder.encode(config.voiceId().trim(), StandardCharsets.UTF_8).replace("+", "%20"); // a path segment, not a form
        return HttpRequest.newBuilder(URI.create(baseUrl + "/v1/text-to-speech/" + voice + "?output_format=mp3_44100_128"))
                .timeout(Duration.ofSeconds(30))
                .header("xi-api-key", config.apiKey().trim())
                .header("content-type", "application/json")
                .header("accept", "audio/mpeg")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)))
                .build();
    }

    /**
     * What's worth saying: formatting marks dropped (so "**" isn't read out), whitespace collapsed,
     * and anything past {@link #MAX_TEXT} cut at the last sentence that fits.
     */
    static String speakable(String text) {
        if (text == null) return "";
        String s = text.replaceAll("```[\\s\\S]*?```", " ")
                .replaceAll("[*_`#>]+", "")
                .replaceAll("\\[([^\\]]+)\\]\\([^)]+\\)", "$1")
                .replaceAll("\\s+", " ")
                .trim();
        if (s.length() <= MAX_TEXT) return s;
        String cut = s.substring(0, MAX_TEXT);
        int end = Math.max(cut.lastIndexOf(". "), Math.max(cut.lastIndexOf("? "), cut.lastIndexOf("! ")));
        return (end > MAX_TEXT / 2 ? cut.substring(0, end + 1) : cut).trim();
    }

    private Instant reserve(Long userId) {
        Instant now = Instant.now(clock);
        if (hourly.take("voice-hour:" + userId, PER_HOUR, HOUR_MS) > 0) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, ErrorCode.RATE_LIMITED, "That’s a lot of reading aloud for one hour; your browser’s voice takes over for now.", null);
        }
        return now;
    }

    private void refund(Long userId, Instant at) {
        hourly.giveBack("voice-hour:" + userId, at.toEpochMilli(), HOUR_MS);
    }
}
