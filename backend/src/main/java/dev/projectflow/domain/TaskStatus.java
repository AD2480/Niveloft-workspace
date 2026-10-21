package dev.projectflow.domain;

/** Fixed workflow: TODO → IN_PROGRESS → IN_REVIEW → DONE. */
public enum TaskStatus {
    TODO,
    IN_PROGRESS,
    IN_REVIEW,
    DONE
}
