package dev.projectflow.web.error;

import java.util.Map;
import org.springframework.http.HttpStatus;

/** An expected failure that maps directly to an HTTP error response. */
public class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final ErrorCode code;
    private final Map<String, String> fieldErrors;

    public ApiException(HttpStatus status, ErrorCode code, String message, Map<String, String> fieldErrors) {
        super(message);
        this.status = status;
        this.code = code;
        this.fieldErrors = fieldErrors;
    }

    public HttpStatus status() {
        return status;
    }

    public ErrorCode code() {
        return code;
    }

    public Map<String, String> fieldErrors() {
        return fieldErrors;
    }

    public static ApiException notFound(String message) {
        return new ApiException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, message, null);
    }

    public static ApiException forbidden(String message) {
        return new ApiException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, message, null);
    }

    public static ApiException conflict(String message) {
        return new ApiException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message, null);
    }

    public static ApiException conflict(String message, String field) {
        return new ApiException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message, Map.of(field, message));
    }

    /** A request that would break the task workflow (e.g. skipping review). */
    public static ApiException workflow(String message) {
        return new ApiException(HttpStatus.CONFLICT, ErrorCode.WORKFLOW_VIOLATION, message, null);
    }

    /** The record changed since the client loaded it. */
    public static ApiException editConflict(String message) {
        return new ApiException(HttpStatus.CONFLICT, ErrorCode.EDIT_CONFLICT, message, null);
    }

    public static ApiException unauthorized(String message) {
        return new ApiException(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHORIZED, message, null);
    }

    public static ApiException validation(Map<String, String> fieldErrors) {
        return new ApiException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, "Please correct the highlighted fields.", fieldErrors);
    }

    public static ApiException validation(String field, String message) {
        return validation(Map.of(field, message));
    }
}
