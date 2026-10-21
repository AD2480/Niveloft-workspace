-- Rate limits shared by every API instance, and the "keep me signed in" cookie. Additive only: an
-- older release keeps working against this schema (it ignores the new table and column), so
-- rolling the application back doesn't need a database restore.

-- Rate-limit counts (RATE_LIMIT_STORE=database, the default in production): one row per key and
-- fixed window. bucket_key is a hash of the action and the address or account it limits, so the
-- table holds no email or IP addresses. Rows older than three hours are deleted every few minutes.
CREATE TABLE rate_limit_windows (
    bucket_key    VARCHAR(64)  NOT NULL,
    window_start  BIGINT       NOT NULL,
    hits          INT          NOT NULL DEFAULT 0,
    CONSTRAINT pk_rate_limit_windows PRIMARY KEY (bucket_key, window_start)
);
CREATE INDEX ix_rate_limit_windows_start ON rate_limit_windows (window_start);

-- "Keep me signed in": the SHA-256 of the secret in the session's HttpOnly cookie, which page
-- scripts can't read. Only that cookie can get a new sign-in token for the session once the tab's
-- token is gone. Empty for sessions that aren't remembered.
ALTER TABLE user_sessions ADD COLUMN cookie_hash CHAR(64);
