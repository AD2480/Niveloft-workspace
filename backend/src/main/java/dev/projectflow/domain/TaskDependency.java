package dev.projectflow.domain;

import jakarta.persistence.*;
import java.time.Instant;

/** Finish-to-start dependency: {@code blocker} must be done before {@code blocked} can finish. */
@Entity
@Table(name = "task_dependencies")
public class TaskDependency {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "blocker_task_id")
    private Task blocker;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "blocked_task_id")
    private Task blocked;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "created_by_id")
    private User createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public Long getId() {
        return id;
    }

    public Long getProjectId() {
        return projectId;
    }

    public void setProjectId(Long projectId) {
        this.projectId = projectId;
    }

    public Task getBlocker() {
        return blocker;
    }

    public void setBlocker(Task blocker) {
        this.blocker = blocker;
    }

    public Task getBlocked() {
        return blocked;
    }

    public void setBlocked(Task blocked) {
        this.blocked = blocked;
    }

    public User getCreatedBy() {
        return createdBy;
    }

    public void setCreatedBy(User createdBy) {
        this.createdBy = createdBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
}
