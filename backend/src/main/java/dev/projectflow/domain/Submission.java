package dev.projectflow.domain;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** One immutable, numbered version of submitted work. */
@Entity
@Table(name = "submissions")
public class Submission {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "task_id")
    private Task task;

    @Column(name = "version", nullable = false)
    private int number;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "submitted_by_id")
    private User submittedBy;

    @Column(name = "notes", nullable = false)
    private String notes;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private SubmissionStatus status;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @OneToMany(mappedBy = "submission", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("position ASC")
    private List<SubmissionCriterion> criteria = new ArrayList<>();

    @OneToMany(mappedBy = "submission", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("position ASC")
    private List<EvidenceItem> evidence = new ArrayList<>();

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Task getTask() {
        return task;
    }

    public void setTask(Task task) {
        this.task = task;
    }

    public int getNumber() {
        return number;
    }

    public void setNumber(int number) {
        this.number = number;
    }

    public User getSubmittedBy() {
        return submittedBy;
    }

    public void setSubmittedBy(User submittedBy) {
        this.submittedBy = submittedBy;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
    }

    public SubmissionStatus getStatus() {
        return status;
    }

    public void setStatus(SubmissionStatus status) {
        this.status = status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public List<SubmissionCriterion> getCriteria() {
        return criteria;
    }

    public void setCriteria(List<SubmissionCriterion> criteria) {
        this.criteria = criteria;
    }

    public List<EvidenceItem> getEvidence() {
        return evidence;
    }

    public void setEvidence(List<EvidenceItem> evidence) {
        this.evidence = evidence;
    }
}
