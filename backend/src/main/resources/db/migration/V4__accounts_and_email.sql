-- Real accounts: confirmed email addresses, accepted terms, sign-out-everywhere, and one-time
-- links sent by email (confirm the address, reset the password).

ALTER TABLE users ADD COLUMN email_verified_at DATETIME(6);
ALTER TABLE users ADD COLUMN terms_accepted_at DATETIME(6);
-- Part of every sign-in token; raising it signs the account out everywhere (password reset/change).
ALTER TABLE users ADD COLUMN session_version INT NOT NULL DEFAULT 0;

-- Accounts that existed before this change keep working: they count as confirmed.
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

CREATE TABLE account_tokens (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT      NOT NULL,
    purpose     VARCHAR(20) NOT NULL,
    -- SHA-256 of the token in the emailed link; the link itself is never stored.
    token_hash  CHAR(64)    NOT NULL,
    created_at  DATETIME(6) NOT NULL,
    expires_at  DATETIME(6) NOT NULL,
    used_at     DATETIME(6),
    CONSTRAINT uk_account_tokens_hash UNIQUE (token_hash),
    CONSTRAINT fk_account_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX ix_account_tokens_user ON account_tokens (user_id, purpose);
