-- People's corrections to Flurry's answers: whether an answer was right, what kind of mistake it
-- made (from a fixed list), and what the right answer would have been. Kept so a project's owners
-- and managers can see recurring failures and turn them into eval cases. The question and answer
-- are kept with it (they're the project's own records); 180 days, then removed. Additive only.
CREATE TABLE ai_feedback (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    project_id  BIGINT        NOT NULL,
    user_id     BIGINT,
    verdict     VARCHAR(8)    NOT NULL,
    categories  VARCHAR(200),
    correction  VARCHAR(2000),
    question    VARCHAR(500)  NOT NULL,
    answer      VARCHAR(4000) NOT NULL,
    model       VARCHAR(100),
    lookups     VARCHAR(500),
    created_at  DATETIME(6)   NOT NULL,
    CONSTRAINT fk_ai_feedback_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_ai_feedback_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX ix_ai_feedback_project ON ai_feedback (project_id, created_at);
