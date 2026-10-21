package dev.projectflow.domain;

import jakarta.persistence.*;
import java.time.Instant;

/** A recorded status transition; the source for time-based analytics. */
@Entity
@Table(name = "task_status_events")
public class TaskStatusEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "task_id")
    private Task task;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Enumerated(EnumType.STRING)
    @Column(name = "from_status", nullable = true)
    private TaskStatus fromStatus;

    @Enumerated(EnumType.STRING)
    @Column(name = "to_status", nullable = false)
    private TaskStatus toStatus;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "actor_id")
    private User actor;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

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

    public Long getProjectId() {
        return projectId;
    }

    public void setProjectId(Long projectId) {
        this.projectId = projectId;
    }

    public TaskStatus getFromStatus() {
        return fromStatus;
    }

    public void setFromStatus(TaskStatus fromStatus) {
        this.fromStatus = fromStatus;
    }

    public TaskStatus getToStatus() {
        return toStatus;
    }

    public void setToStatus(TaskStatus toStatus) {
        this.toStatus = toStatus;
    }

    public User getActor() {
        return actor;
    }

    public void setActor(User actor) {
        this.actor = actor;
    }

    public Instant getOccurredAt() {
        return occurredAt;
    }

    public void setOccurredAt(Instant occurredAt) {
        this.occurredAt = occurredAt;
    }
}
