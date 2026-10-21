package dev.projectflow.domain;

import jakarta.persistence.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** A unit of work that moves through To Do → In Progress → In Review → Done. */
@Entity
@Table(name = "tasks")
public class Task {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "project_id")
    private Project project;

    @Column(name = "task_number", nullable = false)
    private int number;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "description", nullable = true)
    private String description;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private TaskStatus status;

    @Enumerated(EnumType.STRING)
    @Column(name = "priority", nullable = false)
    private Priority priority;

    @ManyToOne(fetch = FetchType.LAZY, optional = true)
    @JoinColumn(name = "assignee_id")
    private User assignee;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "reporter_id")
    private User reporter;

    @Column(name = "due_date", nullable = true)
    private LocalDate dueDate;

    @ManyToOne(fetch = FetchType.LAZY, optional = true)
    @JoinColumn(name = "milestone_id")
    private Milestone milestone;

    @Column(name = "position", nullable = false)
    private double position;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "started_at", nullable = true)
    private Instant startedAt;

    /** Estimated effort in working days; null when nobody has estimated the task. */
    @Column(name = "estimate_days", nullable = true)
    private Integer estimateDays;

    @Column(name = "completed_at", nullable = true)
    private Instant completedAt;

    @Version
    @Column(name = "version", nullable = false)
    private long version;

    @OneToMany(mappedBy = "task", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("position ASC")
    private List<AcceptanceCriterion> criteria = new ArrayList<>();

    @OneToMany(mappedBy = "task", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("position ASC")
    private List<ChecklistItem> checklist = new ArrayList<>();

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Project getProject() {
        return project;
    }

    public void setProject(Project project) {
        this.project = project;
    }

    public int getNumber() {
        return number;
    }

    public void setNumber(int number) {
        this.number = number;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public TaskStatus getStatus() {
        return status;
    }

    public void setStatus(TaskStatus status) {
        this.status = status;
    }

    public Priority getPriority() {
        return priority;
    }

    public void setPriority(Priority priority) {
        this.priority = priority;
    }

    public User getAssignee() {
        return assignee;
    }

    public void setAssignee(User assignee) {
        this.assignee = assignee;
    }

    public User getReporter() {
        return reporter;
    }

    public void setReporter(User reporter) {
        this.reporter = reporter;
    }

    public LocalDate getDueDate() {
        return dueDate;
    }

    public void setDueDate(LocalDate dueDate) {
        this.dueDate = dueDate;
    }

    public Milestone getMilestone() {
        return milestone;
    }

    public void setMilestone(Milestone milestone) {
        this.milestone = milestone;
    }

    public double getPosition() {
        return position;
    }

    public void setPosition(double position) {
        this.position = position;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(Instant startedAt) {
        this.startedAt = startedAt;
    }

    public Integer getEstimateDays() {
        return estimateDays;
    }

    public void setEstimateDays(Integer estimateDays) {
        this.estimateDays = estimateDays;
    }

    public Instant getCompletedAt() {
        return completedAt;
    }

    public void setCompletedAt(Instant completedAt) {
        this.completedAt = completedAt;
    }

    public long getVersion() {
        return version;
    }

    public List<AcceptanceCriterion> getCriteria() {
        return criteria;
    }

    public void setCriteria(List<AcceptanceCriterion> criteria) {
        this.criteria = criteria;
    }

    public List<ChecklistItem> getChecklist() {
        return checklist;
    }

    public void setChecklist(List<ChecklistItem> checklist) {
        this.checklist = checklist;
    }
}
