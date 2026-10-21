package dev.projectflow.web.error;

/** Machine-readable error codes; the frontend branches on these, not on messages. */
public enum ErrorCode {
    VALIDATION_FAILED,
    UNAUTHORIZED,
    FORBIDDEN,
    NOT_FOUND,
    CONFLICT,
    WORKFLOW_VIOLATION,
    EDIT_CONFLICT,
    /** AI assistance isn't configured on this server, or the per-user limit was reached. */
    AI_UNAVAILABLE,
    /** The AI provider failed or returned something unusable. */
    AI_FAILED,
    /** Too many attempts from this address or for this account; try again later. */
    RATE_LIMITED,
    /** The account exists, but its email address hasn't been confirmed yet. */
    EMAIL_NOT_VERIFIED,
    /** A link from an email is invalid, used or expired. */
    LINK_EXPIRED,
    /** A feature needs something the server doesn't have configured (e.g. email). */
    NOT_AVAILABLE,
    /** The same request (same Idempotency-Key) is still being processed. */
    DUPLICATE_REQUEST,
    /** An Idempotency-Key was reused for a different request. */
    IDEMPOTENCY_MISMATCH,
    /** A size or count limit was reached (request body, tasks per project, storage…). */
    LIMIT_REACHED,
    /** A spending cap for a paid service (AI, email) was reached for this day or month. */
    SPENDING_CAP,
    /** The account was suspended by an operator. */
    ACCOUNT_SUSPENDED,
    /** Too many requests of this kind are running on the server right now; try again shortly. */
    BUSY,
    /** The server or its database is overloaded or timed out; retrying later should work. */
    UNAVAILABLE,
    INTERNAL_ERROR
}
