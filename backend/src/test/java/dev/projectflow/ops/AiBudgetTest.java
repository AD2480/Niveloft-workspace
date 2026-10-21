// Ported from the plain-Java checks that ran in the sandbox for the launch release (the same
// assertions, now run by ./mvnw verify).
package dev.projectflow.ops;

import dev.projectflow.config.LaunchProperties;
import dev.projectflow.config.OpsProperties;
import dev.projectflow.web.error.ApiException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Flurry's budget: reservations, refusals at each cap, settlement and refunds, and the concurrency limit. */
class AiBudgetTest {
    static final List<String> results = new ArrayList<>();

    static void check(String name, boolean ok) {
        results.add((ok ? "PASS  " : "FAIL  ") + name);
    }

    /** Counters in memory, with the same capped-add rule as the database version. */
    static class Memory extends UsageCounters {
        final Map<String, Long> m = new ConcurrentHashMap<>();
        boolean broken;

        Memory(Clock clock) {
            super(null, clock);
        }

        @Override
        public long get(String c, String p) {
            if (broken) throw new IllegalStateException("database down");
            return m.getOrDefault(c + "|" + p, 0L);
        }

        @Override
        public synchronized long add(String c, String p, long d) {
            if (broken) throw new IllegalStateException("database down");
            return m.merge(c + "|" + p, d, Long::sum);
        }

        @Override
        public synchronized boolean tryAdd(String c, String p, long d, long cap) {
            if (broken) throw new IllegalStateException("database down");
            long now = get(c, p);
            if (cap > 0 && now + d > cap) return false;
            add(c, p, d);
            return true;
        }
    }

    static String status(ApiException e) {
        return e.status().value() + " " + e.code();
    }

    @org.junit.jupiter.api.Test
    void allRules() throws Exception {
        results.clear();
        Clock clock = Clock.fixed(Instant.parse("2026-10-14T10:00:00Z"), ZoneOffset.UTC);
        Memory mem = new Memory(clock);
        OpsProperties ops = new OpsProperties(null, new OpsProperties.Spending(3, 10_000L, null, null));
        LaunchProperties launch = new LaunchProperties(null, null, null, null, null, null, new LaunchProperties.Ai(2, 2));
        AiBudget b = new AiBudget(mem, ops, launch, null, null, clock, null);

        AiBudget.Ticket t1 = b.reserve(7L, 1L, "question", 1000);
        check("a reservation takes a request and the estimate", mem.get("ai.requests", "2026-10-14") == 1 && mem.get("ai.tokens", "2026-10") == 1000);
        AiBudget.Ticket t2 = b.reserve(7L, 1L, "question", 1000);
        String busy = "";
        try {
            b.reserve(8L, 2L, "question", 1000);
        } catch (ApiException e) {
            busy = status(e);
        }
        check("a third question at once is refused as busy (503), not queued", busy.equals("503 BUSY") && b.inFlight() == 2);
        b.settle(t1, 400, 1, "lookups: find_tasks found");
        check("settling replaces the estimate with what was used", mem.get("ai.tokens", "2026-10") == 1400 && b.inFlight() == 1);
        String project = "";
        try {
            b.reserve(9L, 1L, "summary", 100);
        } catch (ApiException e) {
            project = status(e) + " " + e.getMessage();
        }
        check("the project's daily cap (2) is enforced per project", project.startsWith("429 SPENDING_CAP") && project.contains("this project"));
        check("…and the refused request gave back the server's request", mem.get("ai.requests", "2026-10-14") == 2);
        b.cancel(t2, "provider failed");
        check("a request the provider never answered is given back entirely", mem.get("ai.requests", "2026-10-14") == 1
                && mem.get("ai.project.1", "2026-10-14") == 1 && mem.get("ai.tokens", "2026-10") == 400 && b.inFlight() == 0);
        AiBudget.Ticket t3 = b.reserve(9L, 2L, "question", 500);
        b.settle(t3, 900, 3, null);
        check("a question with three rounds counts three requests", mem.get("ai.requests", "2026-10-14") == 4);
        String day = "";
        try {
            b.reserve(9L, 3L, "question", 100);
        } catch (ApiException e) {
            day = status(e) + " " + e.getMessage();
        }
        check("the server's daily cap is enforced", day.startsWith("429 SPENDING_CAP") && day.contains("Today’s AI budget for this server") && b.inFlight() == 0);

        Memory mem2 = new Memory(clock);
        AiBudget tokens = new AiBudget(mem2, new OpsProperties(null, new OpsProperties.Spending(0, 1500L, null, null)), launch, null, null, clock, null);
        AiBudget.Ticket a = tokens.reserve(1L, null, "plan", 1000);
        String month = "";
        try {
            tokens.reserve(1L, null, "plan", 1000);
        } catch (ApiException e) {
            month = e.getMessage();
        }
        check("the monthly token budget refuses an estimate that wouldn't fit", month.contains("This month’s AI budget"));
        tokens.settle(a, 200, 1, null);
        check("…and room comes back when the real use was smaller", tokens.reserve(1L, null, "plan", 1000) != null);

        Memory down = new Memory(clock);
        down.broken = true;
        AiBudget blind = new AiBudget(down, ops, launch, null, null, clock, null);
        String unknown = "";
        try {
            blind.reserve(1L, 1L, "question", 100);
        } catch (ApiException e) {
            unknown = status(e);
        }
        check("if spending can't be read, the request is refused (fail closed)", unknown.equals("503 AI_UNAVAILABLE") && blind.inFlight() == 0);
        org.assertj.core.api.Assertions.assertThat(results.stream().filter(r -> r.startsWith("FAIL")).toList()).as("failed checks").isEmpty();
    }
}
