package dev.projectflow.ai;

/** A text-completion provider. Implementations hold the API key; nothing here reaches the browser. */
public interface AiClient {

    /** The model's reply to one system + user message pair. Throws {@link AiClientException} on any failure. */
    Completion complete(String system, String user, int maxTokens);

    /**
     * A reply and the tokens it used (in + out), for spending caps. When the provider doesn't say,
     * the tokens are estimated at four characters each.
     */
    record Completion(String text, long tokens) {
        static Completion of(String text, long reported, String system, String user) {
            return new Completion(text, reported > 0 ? reported : estimate(system, user, text));
        }

        static long estimate(String... parts) {
            long chars = 0;
            for (String p : parts) chars += p == null ? 0 : p.length();
            return Math.max(1, chars / 4);
        }
    }

    class AiClientException extends RuntimeException {
        public AiClientException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
