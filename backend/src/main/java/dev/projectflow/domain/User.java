package dev.projectflow.domain;

import jakarta.persistence.*;
import java.time.Instant;

/** A person with a Niveloft account. */
@Entity
@Table(name = "users")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "email", nullable = false)
    private String email;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(name = "avatar_color", nullable = false)
    private String avatarColor;

    @Column(name = "job_title", nullable = true)
    private String jobTitle;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /** When the person proved they own the email address (null until then). */
    @Column(name = "email_verified_at", nullable = true)
    private Instant emailVerifiedAt;

    /** When the person accepted the terms and privacy policy at registration. */
    @Column(name = "terms_accepted_at", nullable = true)
    private Instant termsAcceptedAt;

    /** Carried in every sign-in token; raising it signs the account out everywhere. */
    @Column(name = "session_version", nullable = false)
    private int sessionVersion;

    /** When this person last caught up on Today; what happened after it is "since you were last here". */
    @Column(name = "caught_up_at")
    private Instant caughtUpAt;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public String getAvatarColor() {
        return avatarColor;
    }

    public void setAvatarColor(String avatarColor) {
        this.avatarColor = avatarColor;
    }

    public String getJobTitle() {
        return jobTitle;
    }

    public void setJobTitle(String jobTitle) {
        this.jobTitle = jobTitle;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getEmailVerifiedAt() {
        return emailVerifiedAt;
    }

    public void setEmailVerifiedAt(Instant emailVerifiedAt) {
        this.emailVerifiedAt = emailVerifiedAt;
    }

    public boolean isEmailVerified() {
        return emailVerifiedAt != null;
    }

    public Instant getTermsAcceptedAt() {
        return termsAcceptedAt;
    }

    public void setTermsAcceptedAt(Instant termsAcceptedAt) {
        this.termsAcceptedAt = termsAcceptedAt;
    }

    public Instant getCaughtUpAt() {
        return caughtUpAt;
    }

    public void setCaughtUpAt(Instant caughtUpAt) {
        this.caughtUpAt = caughtUpAt;
    }

    public int getSessionVersion() {
        return sessionVersion;
    }

    /** Invalidates every token issued before now. */
    public void bumpSessionVersion() {
        this.sessionVersion++;
    }

    /** When an operator suspended the account (it can't sign in), or null. */
    @Column(name = "suspended_at")
    private Instant suspendedAt;

    /** When the account was deleted: its personal details were removed and it can't sign in. */
    @Column(name = "deleted_at")
    private Instant deletedAt;

    public Instant getSuspendedAt() {
        return suspendedAt;
    }

    public void setSuspendedAt(Instant suspendedAt) {
        this.suspendedAt = suspendedAt;
    }

    public Instant getDeletedAt() {
        return deletedAt;
    }

    public void setDeletedAt(Instant deletedAt) {
        this.deletedAt = deletedAt;
    }
}
