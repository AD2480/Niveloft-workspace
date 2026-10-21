package dev.projectflow.domain;

/** Project-specific role. Higher rank = more permissions. */
public enum Role {
    VIEWER(0),
    MEMBER(1),
    MANAGER(2),
    OWNER(3);

    private final int rank;

    Role(int rank) {
        this.rank = rank;
    }

    public boolean atLeast(Role other) {
        return rank >= other.rank;
    }
}
