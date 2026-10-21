-- ProjectFlow schema, version 1 (Phase 1).
-- Standard SQL that runs on MySQL 8.4 (production) and H2 in MySQL mode (tests).
-- All timestamps are stored in UTC (DATETIME(6)); calendar dates use DATE.

CREATE TABLE users (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(80)  NOT NULL,
    email           VARCHAR(254) NOT NULL,
    password_hash   VARCHAR(100) NOT NULL,
    avatar_color    CHAR(7)      NOT NULL,
    job_title       VARCHAR(80),
    created_at      DATETIME(6)  NOT NULL,
    CONSTRAINT uk_users_email UNIQUE (email)
);

CREATE TABLE projects (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    project_key     VARCHAR(6)   NOT NULL,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    color           CHAR(7)      NOT NULL,
    status          VARCHAR(16)  NOT NULL,
    start_date      DATE         NOT NULL,
    deadline        DATE,
    owner_id        BIGINT       NOT NULL,
    task_seq        INT          NOT NULL DEFAULT 0,
    created_at      DATETIME(6)  NOT NULL,
    updated_at      DATETIME(6)  NOT NULL,
    version         BIGINT       NOT NULL DEFAULT 0,
    CONSTRAINT uk_projects_key UNIQUE (project_key),
    CONSTRAINT fk_projects_owner FOREIGN KEY (owner_id) REFERENCES users (id)
);

CREATE TABLE project_members (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    project_id      BIGINT       NOT NULL,
    user_id         BIGINT       NOT NULL,
    role            VARCHAR(16)  NOT NULL,
    joined_at       DATETIME(6)  NOT NULL,
    CONSTRAINT uk_members_project_user UNIQUE (project_id, user_id),
    CONSTRAINT fk_members_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users (id)
);
CREATE INDEX idx_members_user ON project_members (user_id);

CREATE TABLE invitations (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    project_id      BIGINT       NOT NULL,
    email           VARCHAR(254) NOT NULL,
    role            VARCHAR(16)  NOT NULL,
    status          VARCHAR(16)  NOT NULL,
    invited_by_id   BIGINT       NOT NULL,
    created_at      DATETIME(6)  NOT NULL,
    responded_at    DATETIME(6),
    CONSTRAINT fk_invitations_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_invitations_inviter FOREIGN KEY (invited_by_id) REFERENCES users (id)
);
CREATE INDEX idx_invitations_email_status ON invitations (email, status);

CREATE TABLE milestones (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    project_id      BIGINT       NOT NULL,
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    due_date        DATE         NOT NULL,
    completed       BOOLEAN      NOT NULL DEFAULT FALSE,
    completed_at    DATETIME(6),
    created_at      DATETIME(6)  NOT NULL,
    CONSTRAINT fk_milestones_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);

CREATE TABLE tasks (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    project_id      BIGINT       NOT NULL,
    task_number     INT          NOT NULL,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    status          VARCHAR(16)  NOT NULL,
    priority        VARCHAR(16)  NOT NULL,
    assignee_id     BIGINT,
    reporter_id     BIGINT       NOT NULL,
    due_date        DATE,
    milestone_id    BIGINT,
    position        DOUBLE       NOT NULL,
    created_at      DATETIME(6)  NOT NULL,
    updated_at      DATETIME(6)  NOT NULL,
    started_at      DATETIME(6),
    completed_at    DATETIME(6),
    version         BIGINT       NOT NULL DEFAULT 0,
    CONSTRAINT uk_tasks_project_number UNIQUE (project_id, task_number),
    CONSTRAINT fk_tasks_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_tasks_assignee FOREIGN KEY (assignee_id) REFERENCES users (id),
    CONSTRAINT fk_tasks_reporter FOREIGN KEY (reporter_id) REFERENCES users (id),
    CONSTRAINT fk_tasks_milestone FOREIGN KEY (milestone_id) REFERENCES milestones (id) ON DELETE SET NULL
);
CREATE INDEX idx_tasks_board ON tasks (project_id, status, position);
CREATE INDEX idx_tasks_assignee ON tasks (assignee_id, status);

-- What "done" means for a task, written before the work starts.
CREATE TABLE acceptance_criteria (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_id         BIGINT       NOT NULL,
    position        INT          NOT NULL,
    content         VARCHAR(500) NOT NULL,
    CONSTRAINT fk_criteria_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
);
CREATE INDEX idx_criteria_task ON acceptance_criteria (task_id, position);

-- Steps the assignee ticks off; all must be done before submitting.
CREATE TABLE checklist_items (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_id         BIGINT       NOT NULL,
    position        INT          NOT NULL,
    content         VARCHAR(300) NOT NULL,
    done            BOOLEAN      NOT NULL DEFAULT FALSE,
    done_by_id      BIGINT,
    done_at         DATETIME(6),
    CONSTRAINT fk_checklist_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
    CONSTRAINT fk_checklist_done_by FOREIGN KEY (done_by_id) REFERENCES users (id)
);
CREATE INDEX idx_checklist_task ON checklist_items (task_id, position);

CREATE TABLE comments (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_id         BIGINT       NOT NULL,
    author_id       BIGINT       NOT NULL,
    body            TEXT         NOT NULL,
    created_at      DATETIME(6)  NOT NULL,
    updated_at      DATETIME(6),
    CONSTRAINT fk_comments_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
    CONSTRAINT fk_comments_author FOREIGN KEY (author_id) REFERENCES users (id)
);
CREATE INDEX idx_comments_task ON comments (task_id, created_at);

-- Uploaded evidence files. Bytes live on disk under storage_key; access is checked per project.
CREATE TABLE stored_files (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    project_id      BIGINT       NOT NULL,
    original_name   VARCHAR(255) NOT NULL,
    content_type    VARCHAR(127) NOT NULL,
    size_bytes      BIGINT       NOT NULL,
    storage_key     VARCHAR(80)  NOT NULL,
    uploaded_by_id  BIGINT       NOT NULL,
    created_at      DATETIME(6)  NOT NULL,
    CONSTRAINT uk_files_key UNIQUE (storage_key),
    CONSTRAINT fk_files_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_files_uploader FOREIGN KEY (uploaded_by_id) REFERENCES users (id)
);

-- Immutable, numbered versions of submitted work.
CREATE TABLE submissions (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_id         BIGINT       NOT NULL,
    version         INT          NOT NULL,
    submitted_by_id BIGINT       NOT NULL,
    notes           TEXT         NOT NULL,
    status          VARCHAR(24)  NOT NULL,
    created_at      DATETIME(6)  NOT NULL,
    CONSTRAINT uk_submissions_task_version UNIQUE (task_id, version),
    CONSTRAINT fk_submissions_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
    CONSTRAINT fk_submissions_user FOREIGN KEY (submitted_by_id) REFERENCES users (id)
);

-- Acceptance criteria as they were when the version was submitted (criteria may change later).
CREATE TABLE submission_criteria (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    submission_id   BIGINT       NOT NULL,
    criterion_id    BIGINT,
    position        INT          NOT NULL,
    content         VARCHAR(500) NOT NULL,
    CONSTRAINT fk_subcrit_submission FOREIGN KEY (submission_id) REFERENCES submissions (id) ON DELETE CASCADE
);

CREATE TABLE evidence_items (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    submission_id   BIGINT       NOT NULL,
    position        INT          NOT NULL,
    kind            VARCHAR(16)  NOT NULL,
    label           VARCHAR(120) NOT NULL,
    url             VARCHAR(2048),
    file_id         BIGINT,
    CONSTRAINT fk_evidence_submission FOREIGN KEY (submission_id) REFERENCES submissions (id) ON DELETE CASCADE,
    CONSTRAINT fk_evidence_file FOREIGN KEY (file_id) REFERENCES stored_files (id) ON DELETE CASCADE
);

CREATE TABLE reviews (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    submission_id   BIGINT       NOT NULL,
    reviewer_id     BIGINT       NOT NULL,
    decision        VARCHAR(24)  NOT NULL,
    feedback        TEXT,
    created_at      DATETIME(6)  NOT NULL,
    CONSTRAINT uk_reviews_submission UNIQUE (submission_id),
    CONSTRAINT fk_reviews_submission FOREIGN KEY (submission_id) REFERENCES submissions (id) ON DELETE CASCADE,
    CONSTRAINT fk_reviews_reviewer FOREIGN KEY (reviewer_id) REFERENCES users (id)
);

-- Reviewer's verdict on each acceptance criterion of the submitted version.
CREATE TABLE review_criterion_results (
    id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
    review_id               BIGINT        NOT NULL,
    submission_criterion_id BIGINT        NOT NULL,
    met                     BOOLEAN       NOT NULL,
    note                    VARCHAR(1000),
    CONSTRAINT fk_rcr_review FOREIGN KEY (review_id) REFERENCES reviews (id) ON DELETE CASCADE,
    CONSTRAINT fk_rcr_criterion FOREIGN KEY (submission_criterion_id) REFERENCES submission_criteria (id) ON DELETE CASCADE
);

CREATE TABLE notifications (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT        NOT NULL,
    type            VARCHAR(32)   NOT NULL,
    title           VARCHAR(200)  NOT NULL,
    message         VARCHAR(1000) NOT NULL,
    link            VARCHAR(255),
    is_read         BOOLEAN       NOT NULL DEFAULT FALSE,
    actor_id        BIGINT,
    invitation_id   BIGINT,
    project_id      BIGINT,
    created_at      DATETIME(6)   NOT NULL,
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_actor FOREIGN KEY (actor_id) REFERENCES users (id),
    CONSTRAINT fk_notifications_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
CREATE INDEX idx_notifications_user ON notifications (user_id, is_read, created_at);

-- Human-readable audit trail. task_id has no foreign key so history survives task deletion.
CREATE TABLE activities (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    project_id      BIGINT        NOT NULL,
    task_id         BIGINT,
    actor_id        BIGINT        NOT NULL,
    type            VARCHAR(40)   NOT NULL,
    message         VARCHAR(500)  NOT NULL,
    field_name      VARCHAR(40),
    old_value       VARCHAR(500),
    new_value       VARCHAR(500),
    created_at      DATETIME(6)   NOT NULL,
    CONSTRAINT fk_activities_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_activities_actor FOREIGN KEY (actor_id) REFERENCES users (id)
);
CREATE INDEX idx_activities_project ON activities (project_id, created_at);
CREATE INDEX idx_activities_task ON activities (task_id, created_at);

-- Every status transition with its time: the event history that analytics
-- (time in review, cycle time, time blocked) are calculated from.
CREATE TABLE task_status_events (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_id         BIGINT        NOT NULL,
    project_id      BIGINT        NOT NULL,
    from_status     VARCHAR(16),
    to_status       VARCHAR(16)   NOT NULL,
    actor_id        BIGINT        NOT NULL,
    occurred_at     DATETIME(6)   NOT NULL,
    CONSTRAINT fk_tse_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
    CONSTRAINT fk_tse_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_tse_actor FOREIGN KEY (actor_id) REFERENCES users (id)
);
CREATE INDEX idx_tse_task ON task_status_events (task_id, occurred_at);
CREATE INDEX idx_tse_project ON task_status_events (project_id, occurred_at);
