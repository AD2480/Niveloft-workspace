package dev.projectflow.domain;

import jakarta.persistence.*;

/** Evidence attached to a submission: a link or an uploaded file. */
@Entity
@Table(name = "evidence_items")
public class EvidenceItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "submission_id")
    private Submission submission;

    @Column(name = "position", nullable = false)
    private int position;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", nullable = false)
    private EvidenceKind kind;

    @Column(name = "label", nullable = false)
    private String label;

    @Column(name = "url", nullable = true)
    private String url;

    @ManyToOne(fetch = FetchType.LAZY, optional = true)
    @JoinColumn(name = "file_id")
    private StoredFile file;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Submission getSubmission() {
        return submission;
    }

    public void setSubmission(Submission submission) {
        this.submission = submission;
    }

    public int getPosition() {
        return position;
    }

    public void setPosition(int position) {
        this.position = position;
    }

    public EvidenceKind getKind() {
        return kind;
    }

    public void setKind(EvidenceKind kind) {
        this.kind = kind;
    }

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public String getUrl() {
        return url;
    }

    public void setUrl(String url) {
        this.url = url;
    }

    public StoredFile getFile() {
        return file;
    }

    public void setFile(StoredFile file) {
        this.file = file;
    }
}
