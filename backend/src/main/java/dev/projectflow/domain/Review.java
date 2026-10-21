package dev.projectflow.domain;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** A reviewer decision on one submission. */
@Entity
@Table(name = "reviews")
public class Review {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "submission_id")
    private Submission submission;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "reviewer_id")
    private User reviewer;

    @Enumerated(EnumType.STRING)
    @Column(name = "decision", nullable = false)
    private ReviewDecision decision;

    @Column(name = "feedback", nullable = true)
    private String feedback;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @OneToMany(mappedBy = "review", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("id ASC")
    private List<ReviewCriterionResult> results = new ArrayList<>();

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

    public User getReviewer() {
        return reviewer;
    }

    public void setReviewer(User reviewer) {
        this.reviewer = reviewer;
    }

    public ReviewDecision getDecision() {
        return decision;
    }

    public void setDecision(ReviewDecision decision) {
        this.decision = decision;
    }

    public String getFeedback() {
        return feedback;
    }

    public void setFeedback(String feedback) {
        this.feedback = feedback;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public List<ReviewCriterionResult> getResults() {
        return results;
    }

    public void setResults(List<ReviewCriterionResult> results) {
        this.results = results;
    }
}
