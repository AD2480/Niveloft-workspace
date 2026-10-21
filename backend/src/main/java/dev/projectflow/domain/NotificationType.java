package dev.projectflow.domain;

/** Inbox notification categories. */
public enum NotificationType {
    TASK_ASSIGNED,
    INVITATION,
    SUBMISSION,
    REVIEW_APPROVED,
    CHANGES_REQUESTED,
    COMMENT,
    /** Someone @mentioned you in a comment or a task description. */
    MENTION,
    ROLE_CHANGED,
    PLAN_CHANGED
}
