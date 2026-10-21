package dev.projectflow.domain;

import jakarta.persistence.*;
import java.time.Instant;

/** Invitation for an email address to join a project with a role. */
@Entity
@Table(name = "invitations")
public class Invitation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "project_id")
    private Project project;

    @Column(name = "email", nullable = false)
    private String email;

    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false)
    private Role role;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private InvitationStatus status;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "invited_by_id")
    private User invitedBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "responded_at", nullable = true)
    private Instant respondedAt;

    /** How long an invitation can be accepted. */
    public static final java.time.Duration TTL = java.time.Duration.ofDays(14);

    /** Null for invitations sent before expiry existed: they count from when they were sent. */
    @Column(name = "expires_at")
    private Instant expiresAt;

    public Instant getExpiresAt() {
        return expiresAt != null ? expiresAt : createdAt == null ? null : createdAt.plus(TTL);
    }

    public void setExpiresAt(Instant expiresAt) {
        this.expiresAt = expiresAt;
    }

    public boolean expiredAt(Instant now) {
        Instant e = getExpiresAt();
        return e != null && !now.isBefore(e);
    }

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

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public Role getRole() {
        return role;
    }

    public void setRole(Role role) {
        this.role = role;
    }

    public InvitationStatus getStatus() {
        return status;
    }

    public void setStatus(InvitationStatus status) {
        this.status = status;
    }

    public User getInvitedBy() {
        return invitedBy;
    }

    public void setInvitedBy(User invitedBy) {
        this.invitedBy = invitedBy;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getRespondedAt() {
        return respondedAt;
    }

    public void setRespondedAt(Instant respondedAt) {
        this.respondedAt = respondedAt;
    }
}
