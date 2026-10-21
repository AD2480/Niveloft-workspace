-- Project documents Flurry can search: specifications, meeting notes, decisions. A member writes or
-- imports one as a draft; an owner or manager approves it, and only approved documents are
-- searched. Changing an approved document's text sends it back to draft. Passages are the text
-- split at headings and paragraphs, so an answer can cite the exact part it used. Additive only.
CREATE TABLE project_documents (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    project_id  BIGINT        NOT NULL,
    title       VARCHAR(160)  NOT NULL,
    body        MEDIUMTEXT    NOT NULL,
    status      VARCHAR(16)   NOT NULL,
    created_by  BIGINT,
    created_at  DATETIME(6)   NOT NULL,
    updated_by  BIGINT,
    updated_at  DATETIME(6)   NOT NULL,
    approved_by BIGINT,
    approved_at DATETIME(6),
    version     INT           NOT NULL DEFAULT 0,
    CONSTRAINT fk_project_documents_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_project_documents_created FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_project_documents_updated FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_project_documents_approved FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX ix_project_documents_project ON project_documents (project_id, status);

CREATE TABLE document_passages (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    document_id BIGINT        NOT NULL,
    project_id  BIGINT        NOT NULL,
    ordinal     INT           NOT NULL,
    heading     VARCHAR(300),
    content     TEXT          NOT NULL,
    CONSTRAINT fk_document_passages_document FOREIGN KEY (document_id) REFERENCES project_documents (id) ON DELETE CASCADE
);
CREATE INDEX ix_document_passages_document ON document_passages (document_id, ordinal);
CREATE INDEX ix_document_passages_project ON document_passages (project_id);
