package dev.projectflow.web.error;

import org.springframework.dao.TransientDataAccessException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.transaction.TransactionTimedOutException;
import org.springframework.dao.QueryTimeoutException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.context.request.async.AsyncRequestTimeoutException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Turns every exception into the consistent {@link ApiErrorBody} shape.
 * Expected failures carry their own status and code; anything unexpected is
 * logged and reported as a generic 500 without leaking internals.
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    private ResponseEntity<ApiErrorBody> body(HttpStatus status, ErrorCode code, String message, Map<String, String> fields, HttpServletRequest req) {
        return ResponseEntity.status(status)
                .body(ApiErrorBody.of(status.value(), code, status.getReasonPhrase(), message, fields, req.getRequestURI()));
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ApiErrorBody> api(ApiException e, HttpServletRequest req) {
        return body(e.status(), e.code(), e.getMessage(), e.fieldErrors(), req);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiErrorBody> invalid(MethodArgumentNotValidException e, HttpServletRequest req) {
        Map<String, String> fields = new LinkedHashMap<>();
        e.getBindingResult().getFieldErrors().forEach(fe -> fields.putIfAbsent(fe.getField(), fe.getDefaultMessage()));
        return body(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, "Please correct the highlighted fields.", fields, req);
    }

    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiErrorBody> constraint(ConstraintViolationException e, HttpServletRequest req) {
        Map<String, String> fields = new LinkedHashMap<>();
        e.getConstraintViolations().forEach(v -> {
            String path = v.getPropertyPath().toString();
            fields.putIfAbsent(path.substring(path.lastIndexOf('.') + 1), v.getMessage());
        });
        return body(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, "Please correct the highlighted fields.", fields, req);
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class, MissingServletRequestPartException.class})
    public ResponseEntity<ApiErrorBody> unreadable(Exception e, HttpServletRequest req) {
        return body(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, "The request is malformed or has a value of the wrong type.", null, req);
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ApiErrorBody> tooLarge(MaxUploadSizeExceededException e, HttpServletRequest req) {
        String msg = "Each file must be 10 MB or smaller, and one upload 55 MB at most.";
        return body(HttpStatus.PAYLOAD_TOO_LARGE, ErrorCode.LIMIT_REACHED, msg, Map.of("files", msg), req);
    }

    /**
     * The database was too slow or unreachable (a query or transaction timed out, no connection
     * free). Nothing was saved; retrying in a moment usually works, so say that instead of "error".
     */
    @ExceptionHandler({QueryTimeoutException.class, TransactionTimedOutException.class, CannotCreateTransactionException.class,
            DataAccessResourceFailureException.class, TransientDataAccessException.class})
    public ResponseEntity<ApiErrorBody> busy(Exception e, HttpServletRequest req) {
        log.warn("Database busy or unreachable at {} {}: {}", req.getMethod(), req.getRequestURI(), e.getMessage());
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).header("Retry-After", "5")
                .body(ApiErrorBody.of(503, ErrorCode.UNAVAILABLE, "Service Unavailable", "The server is busy right now, and nothing was changed. Please try again in a moment.", null, req.getRequestURI()));
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiErrorBody> denied(AccessDeniedException e, HttpServletRequest req) {
        return body(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, "You do not have permission to perform this action.", null, req);
    }

    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    public ResponseEntity<ApiErrorBody> optimisticLock(ObjectOptimisticLockingFailureException e, HttpServletRequest req) {
        return body(HttpStatus.CONFLICT, ErrorCode.EDIT_CONFLICT, "Someone else changed this at the same time. Reload to see their changes, then try again.", null, req);
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiErrorBody> integrity(DataIntegrityViolationException e, HttpServletRequest req) {
        log.warn("Data integrity violation at {} {}: {}", req.getMethod(), req.getRequestURI(), e.getMostSpecificCause().getMessage());
        return body(HttpStatus.CONFLICT, ErrorCode.CONFLICT, "The change conflicts with existing data. Reload and try again.", null, req);
    }

    @ExceptionHandler({NoResourceFoundException.class})
    public ResponseEntity<ApiErrorBody> noRoute(Exception e, HttpServletRequest req) {
        return body(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, "No endpoint " + req.getMethod() + " " + req.getRequestURI(), null, req);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ApiErrorBody> method(HttpRequestMethodNotSupportedException e, HttpServletRequest req) {
        return body(HttpStatus.METHOD_NOT_ALLOWED, ErrorCode.NOT_FOUND, "Method " + req.getMethod() + " is not supported here.", null, req);
    }

    /**
     * A live-update stream (SSE) timed out or the browser went away. The response is already a
     * text/event-stream, so there is nothing to write and nothing worth logging as an error.
     */
    @ExceptionHandler({AsyncRequestTimeoutException.class, AsyncRequestNotUsableException.class})
    public void streamClosed() {
        // intentionally empty
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiErrorBody> unexpected(Exception e, HttpServletRequest req) {
        log.error("Unexpected error at {} {}", req.getMethod(), req.getRequestURI(), e);
        return body(HttpStatus.INTERNAL_SERVER_ERROR, ErrorCode.INTERNAL_ERROR, "Something went wrong on the server. Please try again.", null, req);
    }
}
