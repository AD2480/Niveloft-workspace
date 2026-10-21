-- The blocker journey on the Delivery page, counted: how often a blocker was looked at, its
-- evidence opened, its ways forward opened, a response previewed and one confirmed. Nothing about a
-- person, a task or anything written is stored: only the project, the step, the kind of blocker and
-- the kind of response. Additive only, so an older release ignores it. Kept 180 days.
CREATE TABLE journey_events (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    project_id   BIGINT       NOT NULL,
    step         VARCHAR(16)  NOT NULL,
    blocker_kind VARCHAR(16),
    option_kind  VARCHAR(16),
    created_at   DATETIME(6)  NOT NULL,
    CONSTRAINT fk_journey_events_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
CREATE INDEX ix_journey_events_project ON journey_events (project_id, created_at);
