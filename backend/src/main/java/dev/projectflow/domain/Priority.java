package dev.projectflow.domain;

/** Task priority. */
public enum Priority {
    LOW(1),
    MEDIUM(2),
    HIGH(3),
    URGENT(4);

    private final int rank;

    Priority(int rank) {
        this.rank = rank;
    }

    public int rank() {
        return rank;
    }
}
