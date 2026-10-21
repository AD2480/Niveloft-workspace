package dev.projectflow.domain;

/** State of an invitation. */
public enum InvitationStatus {
    PENDING,
    ACCEPTED,
    DECLINED,
    REVOKED
}
