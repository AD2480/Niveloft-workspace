package dev.projectflow.domain;

import jakarta.persistence.*;
import java.time.Instant;

/** A step the assignee completes before submitting. */
@Entity
@Table(name = "checklist_items")
public class ChecklistItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "task_id")
    private Task task;

    @Column(name = "position", nullable = false)
    private int position;

    @Column(name = "content", nullable = false)
    private String content;

    @Column(name = "done", nullable = false)
    private boolean done;

    @ManyToOne(fetch = FetchType.LAZY, optional = true)
    @JoinColumn(name = "done_by_id")
    private User doneBy;

    @Column(name = "done_at", nullable = true)
    private Instant doneAt;

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

    public int getPosition() {
        return position;
    }

    public void setPosition(int position) {
        this.position = position;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public boolean isDone() {
        return done;
    }

    public void setDone(boolean done) {
        this.done = done;
    }

    public User getDoneBy() {
        return doneBy;
    }

    public void setDoneBy(User doneBy) {
        this.doneBy = doneBy;
    }

    public Instant getDoneAt() {
        return doneAt;
    }

    public void setDoneAt(Instant doneAt) {
        this.doneAt = doneAt;
    }
}
