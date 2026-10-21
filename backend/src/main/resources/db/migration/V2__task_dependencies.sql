-- Phase 3: finish-to-start dependencies between tasks of the same project.
-- "blocker" must be done before "blocked" can finish. Cycles are rejected by the service.
CREATE TABLE task_dependencies (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    project_id      BIGINT      NOT NULL,
    blocker_task_id BIGINT      NOT NULL,
    blocked_task_id BIGINT      NOT NULL,
    created_by_id   BIGINT      NOT NULL,
    created_at      DATETIME(6) NOT NULL,
    CONSTRAINT uk_dependency_pair UNIQUE (blocker_task_id, blocked_task_id),
    CONSTRAINT fk_dependency_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_dependency_blocker FOREIGN KEY (blocker_task_id) REFERENCES tasks (id) ON DELETE CASCADE,
    CONSTRAINT fk_dependency_blocked FOREIGN KEY (blocked_task_id) REFERENCES tasks (id) ON DELETE CASCADE,
    CONSTRAINT fk_dependency_creator FOREIGN KEY (created_by_id) REFERENCES users (id)
);
CREATE INDEX idx_dependency_project ON task_dependencies (project_id);
CREATE INDEX idx_dependency_blocked ON task_dependencies (blocked_task_id);
