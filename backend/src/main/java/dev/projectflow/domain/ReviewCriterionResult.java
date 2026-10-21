package dev.projectflow.domain;

import jakarta.persistence.*;

/** Whether one acceptance criterion was met, according to the reviewer. */
@Entity
@Table(name = "review_criterion_results")
public class ReviewCriterionResult {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "review_id")
    private Review review;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "submission_criterion_id")
    private SubmissionCriterion criterion;

    @Column(name = "met", nullable = false)
    private boolean met;

    @Column(name = "note", nullable = true)
    private String note;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Review getReview() {
        return review;
    }

    public void setReview(Review review) {
        this.review = review;
    }

    public SubmissionCriterion getCriterion() {
        return criterion;
    }

    public void setCriterion(SubmissionCriterion criterion) {
        this.criterion = criterion;
    }

    public boolean isMet() {
        return met;
    }

    public void setMet(boolean met) {
        this.met = met;
    }

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }
}
