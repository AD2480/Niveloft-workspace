-- Production launch controls: server-side sessions, an audit log, operator switches, and the
-- columns for suspending and deleting accounts. Additive only: an older release keeps working
-- against this schema (it ignores the new tables and columns), so rolling the application back
-- doesn't need a database restore.

-- One row per sign-in. The sign-in token carries public_id ("sid"); every request checks the row,
-- so signing out, signing out everywhere, a password change and suspension take effect at once.
CREATE TABLE user_sessions (
    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    public_id      CHAR(32)     NOT NULL,
    user_id        BIGINT       NOT NULL,
    remember       BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at     DATETIME(6)  NOT NULL,
    last_seen_at   DATETIME(6)  NOT NULL,
    expires_at     DATETIME(6)  NOT NULL,
    revoked_at     DATETIME(6),
    revoked_reason VARCHAR(32),
    device         VARCHAR(120),
    network        VARCHAR(64),
    CONSTRAINT uk_user_sessions_public UNIQUE (public_id),
    CONSTRAINT fk_user_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX ix_user_sessions_user ON user_sessions (user_id, revoked_at);
CREATE INDEX ix_user_sessions_expires ON user_sessions (expires_at);

-- Sensitive operations: who did what, where, and whether it was allowed. Written by the
-- application only (it has no update or delete path except the retention purge). No foreign keys:
-- a record outlives the project it describes, and a deleted account is anonymised, not removed.
CREATE TABLE audit_events (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    at          DATETIME(6)  NOT NULL,
    actor_id    BIGINT,
    project_id  BIGINT,
    action      VARCHAR(48)  NOT NULL,
    target      VARCHAR(80),
    outcome     VARCHAR(16)  NOT NULL,
    detail      VARCHAR(500),
    network     VARCHAR(64),
    request_id  VARCHAR(64)
);
CREATE INDEX ix_audit_project ON audit_events (project_id, id);
CREATE INDEX ix_audit_actor ON audit_events (actor_id, id);
CREATE INDEX ix_audit_at ON audit_events (at);

-- Emergency switches an operator can flip without a deploy: ai, voice, uploads, exports, signups,
-- invitations. A missing row means on.
CREATE TABLE ops_switches (
    name        VARCHAR(32)  NOT NULL PRIMARY KEY,
    enabled     BOOLEAN      NOT NULL,
    reason      VARCHAR(200),
    changed_at  DATETIME(6)  NOT NULL,
    changed_by  BIGINT
);

ALTER TABLE users ADD COLUMN suspended_at DATETIME(6);
ALTER TABLE users ADD COLUMN deleted_at DATETIME(6);

-- Invitations now expire (older rows count from created_at; see Invitation.expiresAt()).
ALTER TABLE invitations ADD COLUMN expires_at DATETIME(6);
