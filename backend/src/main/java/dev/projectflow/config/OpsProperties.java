package dev.projectflow.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Limits that keep one person, one bot or one bill from taking the service down: request rates,
 * sizes, how much a project can hold, and monthly spending caps on paid services (AI and email).
 * Every value has a safe default; 0 turns a cap off.
 */
@ConfigurationProperties(prefix = "projectflow.ops")
public record OpsProperties(Limits limits, Spending spending) {

    public Limits limitsOrDefault() {
        return limits == null ? new Limits(null, null, null, null, null, null, null, null, null) : limits;
    }

    public Spending spendingOrDefault() {
        return spending == null ? new Spending(null, null, null, null) : spending;
    }

    /**
     * @param requestsPerMinute          per signed-in person, all API calls
     * @param anonymousRequestsPerMinute per IP address, calls without a sign-in
     * @param writesPerMinute            per person, calls that change something
     * @param uploadsPerHour             per person, files uploaded
     * @param maxJsonKb                  largest JSON request body
     * @param maxTasksPerProject         tasks one project can hold
     * @param maxProjectsPerUser         projects one person can own
     * @param maxMembersPerProject       people (and pending invitations) in one project
     * @param storageMbPerProject        uploaded evidence one project can hold
     */
    public record Limits(Integer requestsPerMinute, Integer anonymousRequestsPerMinute, Integer writesPerMinute, Integer uploadsPerHour, Integer maxJsonKb,
                         Integer maxTasksPerProject, Integer maxProjectsPerUser, Integer maxMembersPerProject, Integer storageMbPerProject) {
        public int rpm() { return or(requestsPerMinute, 300); }
        public int anonymousRpm() { return or(anonymousRequestsPerMinute, 120); }
        public int writesPerMin() { return or(writesPerMinute, 60); }
        public int uploadsPerHr() { return or(uploadsPerHour, 60); }
        public int jsonBytes() { return or(maxJsonKb, 512) * 1024; }
        public int tasksPerProject() { return or(maxTasksPerProject, 5000); }
        public int projectsPerUser() { return or(maxProjectsPerUser, 100); }
        public int membersPerProject() { return or(maxMembersPerProject, 200); }
        public long storageBytesPerProject() { return or(storageMbPerProject, 1024) * 1024L * 1024L; }
    }

    /**
     * Spending caps for paid services, for the whole server. When a cap is reached the feature says
     * so and stops until the next day or month; nothing is charged beyond it.
     *
     * @param aiRequestsPerDay AI requests per day (all users together)
     * @param aiTokensPerMonth AI tokens (in + out) per calendar month
     * @param emailsPerDay     emails actually delivered per day (Resend's free tier: 100)
     * @param emailsPerMonth   emails actually delivered per month (Resend's free tier: 3,000)
     */
    public record Spending(Integer aiRequestsPerDay, Long aiTokensPerMonth, Integer emailsPerDay, Integer emailsPerMonth) {
        public int aiPerDay() { return or(aiRequestsPerDay, 1000); }
        public long aiTokens() { return aiTokensPerMonth == null ? 5_000_000L : aiTokensPerMonth; }
        public int emailPerDay() { return or(emailsPerDay, 100); }
        public int emailPerMonth() { return or(emailsPerMonth, 3000); }
    }

    private static int or(Integer v, int fallback) {
        return v == null ? fallback : Math.max(0, v);
    }
}
