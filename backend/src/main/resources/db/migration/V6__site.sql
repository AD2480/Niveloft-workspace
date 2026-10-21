-- The site's own records: contact messages, where new accounts came from (UTM tags) and Arena
-- votes. Form success counts use usage_counters ("form.<form>.<event>" per day).

-- Messages from the Contact form. message_hash (SHA-256 of address and text) finds a message sent
-- twice by accident, so it's saved once.
CREATE TABLE contact_messages (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    name         VARCHAR(80)  NOT NULL,
    email        VARCHAR(254) NOT NULL,
    topic        VARCHAR(20)  NOT NULL,
    message      TEXT         NOT NULL,
    message_hash CHAR(64)     NOT NULL,
    reference    VARCHAR(64),
    page         VARCHAR(200),
    source       VARCHAR(100),
    medium       VARCHAR(100),
    campaign     VARCHAR(100),
    user_id      BIGINT,
    created_at   DATETIME(6)  NOT NULL,
    handled_at   DATETIME(6),
    CONSTRAINT fk_contact_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX ix_contact_hash ON contact_messages (message_hash, created_at);
CREATE INDEX ix_contact_open ON contact_messages (handled_at, created_at);

-- Which campaign or site brought each new account (utm_source, utm_medium, …).
ALTER TABLE users ADD COLUMN signup_source VARCHAR(100);
ALTER TABLE users ADD COLUMN signup_medium VARCHAR(100);
ALTER TABLE users ADD COLUMN signup_campaign VARCHAR(100);
ALTER TABLE users ADD COLUMN signup_term VARCHAR(100);
ALTER TABLE users ADD COLUMN signup_content VARCHAR(100);
ALTER TABLE users ADD COLUMN signup_referrer VARCHAR(255);
ALTER TABLE users ADD COLUMN signup_landing VARCHAR(200);
CREATE INDEX ix_users_created_source ON users (created_at, signup_source);

-- Arena: which of two answer sources a person preferred. The question itself isn't kept.
CREATE TABLE arena_votes (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT       NOT NULL,
    project_id  BIGINT,
    contender_a VARCHAR(120) NOT NULL,
    contender_b VARCHAR(120) NOT NULL,
    winner      VARCHAR(10)  NOT NULL,
    created_at  DATETIME(6)  NOT NULL,
    CONSTRAINT fk_arena_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_arena_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL,
    CONSTRAINT ck_arena_winner CHECK (winner IN ('A', 'B', 'TIE', 'NEITHER')),
    CONSTRAINT ck_arena_distinct CHECK (contender_a <> contender_b)
);
CREATE INDEX ix_arena_created ON arena_votes (created_at);
CREATE INDEX ix_arena_user ON arena_votes (user_id, created_at);
