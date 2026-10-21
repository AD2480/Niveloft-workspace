-- Operations: safe retries (idempotency keys), spending caps (usage counters), and indexes for the
-- queries that list, filter and sort the most.

-- A retried create or submit (double click, flaky network) returns the first result instead of
-- doing it twice. Keys are per person and kept for a day.
CREATE TABLE idempotency_keys (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT       NOT NULL,
    idem_key      VARCHAR(100) NOT NULL,
    -- SHA-256 of method, path and body: the same key with a different request is refused.
    request_hash  CHAR(64)     NOT NULL,
    status_code   INT,
    content_type  VARCHAR(100),
    response_body MEDIUMTEXT,
    created_at    DATETIME(6)  NOT NULL,
    completed_at  DATETIME(6),
    CONSTRAINT uk_idempotency_user_key UNIQUE (user_id, idem_key),
    CONSTRAINT fk_idempotency_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX ix_idempotency_created ON idempotency_keys (created_at);

-- Spending caps: e.g. ("ai.requests", "2026-09-28") or ("email.sent", "2026-09").
CREATE TABLE usage_counters (
    counter_name VARCHAR(40) NOT NULL,
    period_key   VARCHAR(10) NOT NULL,
    amount       BIGINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (counter_name, period_key)
);

-- Inbox filters (by kind of notification), newest first.
CREATE INDEX ix_notifications_user_type ON notifications (user_id, type, created_at);
-- Deadlines and overdue work within a project.
CREATE INDEX ix_tasks_project_due ON tasks (project_id, due_date);
-- Milestones in date order.
CREATE INDEX ix_milestones_project_due ON milestones (project_id, due_date);
-- Review queues: pending submissions.
CREATE INDEX ix_submissions_status ON submissions (status, task_id);
-- Pending invitations of a project.
CREATE INDEX ix_invitations_project_status ON invitations (project_id, status);
-- Expired emailed links are cleaned up by date.
CREATE INDEX ix_account_tokens_expires ON account_tokens (expires_at);
-- Storage used per project (quota).
CREATE INDEX ix_files_project ON stored_files (project_id, size_bytes);
