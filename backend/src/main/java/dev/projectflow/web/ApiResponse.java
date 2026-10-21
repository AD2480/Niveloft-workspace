package dev.projectflow.web;

import java.time.Instant;

/** Envelope for every successful response: {@code { success, message, data, timestamp }}. */
public record ApiResponse<T>(boolean success, String message, T data, Instant timestamp) {

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, null, data, Instant.now());
    }

    public static <T> ApiResponse<T> ok(T data, String message) {
        return new ApiResponse<>(true, message, data, Instant.now());
    }
}
