-- The forecast model trial: a model trained by the ml/ kit, run beside Niveloft's own forecast and
-- never instead of it. Each row is one task's two forecasts of the same thing (working days from
-- when it could proceed to its final submission), recorded the first time the server made them, and
-- what it really took once the work was submitted. A model is named by its file's hash, so rows
-- from different models are never mixed. Numbers only: no text, no names. Additive only.
CREATE TABLE forecast_trial (
    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    project_id     BIGINT       NOT NULL,
    task_id        BIGINT       NOT NULL,
    model_id       VARCHAR(16)  NOT NULL,
    ready_at       DATETIME(6)  NOT NULL,
    model_days     DOUBLE       NOT NULL,
    niveloft_days  DOUBLE       NOT NULL,
    -- true: forecast while the work was in progress; false: checked after the fact, for work that
    -- could only start after the model was trained.
    before_finish  BOOLEAN      NOT NULL,
    predicted_at   DATETIME(6)  NOT NULL,
    actual_days    DOUBLE,
    finished_at    DATETIME(6),
    CONSTRAINT fk_forecast_trial_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_forecast_trial_task FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
    CONSTRAINT uq_forecast_trial UNIQUE (task_id, model_id)
);
CREATE INDEX ix_forecast_trial_project ON forecast_trial (project_id, model_id);
