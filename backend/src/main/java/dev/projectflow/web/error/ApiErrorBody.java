package dev.projectflow.web.error;

import java.time.Instant;
import java.util.Map;

/**
 * Error envelope: {@code { success:false, status, code, error, message, fieldErrors, path, timestamp, requestId }}.
 * {@code requestId} matches the X-Request-Id header and this server's log lines, so a reported
 * error can be found in the logs.
 */
public record ApiErrorBody(
        boolean success,
        int status,
        ErrorCode code,
        String error,
        String message,
        Map<String, String> fieldErrors,
        String path,
        Instant timestamp,
        String requestId) {

    public static ApiErrorBody of(int status, ErrorCode code, String error, String message, Map<String, String> fieldErrors, String path) {
        return new ApiErrorBody(false, status, code, error, message, fieldErrors, path, Instant.now(), org.slf4j.MDC.get("requestId"));
    }
}
