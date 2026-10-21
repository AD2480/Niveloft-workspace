package dev.projectflow.site;

import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Component;

/**
 * The site's own records: contact messages, where new accounts came from (UTM tags), form
 * counts (kept in usage_counters) and Arena votes. Plain SQL, each query on an index (V6).
 */
@Component
public class SiteRecords {

    private final JdbcTemplate jdbc;

    public SiteRecords(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ------------------------------------------------------------------ contact messages

    /** The same message from the same address a moment ago (a double send or a retry). */
    public Optional<Long> recentDuplicate(String messageHash, Instant since) {
        List<Long> ids = jdbc.query("SELECT id FROM contact_messages WHERE message_hash = ? AND created_at >= ? ORDER BY id DESC",
                (rs, i) -> rs.getLong(1), messageHash, Timestamp.from(since));
        return ids.stream().findFirst();
    }

    public long insertContact(Long userId, Requests.Contact c, String messageHash, Instant now) {
        Requests.Attribution a = c.attribution();
        KeyHolder key = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement("""
                    INSERT INTO contact_messages (name, email, topic, message, message_hash, reference, page, source, medium, campaign, user_id, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", new String[] {"id"});
            ps.setString(1, c.name().trim());
            ps.setString(2, c.email().trim().toLowerCase());
            ps.setString(3, c.topic().name());
            ps.setString(4, c.message().trim());
            ps.setString(5, messageHash);
            ps.setString(6, blankToNull(c.reference()));
            ps.setString(7, blankToNull(c.page()));
            ps.setString(8, a == null ? null : tag(a.source(), 100));
            ps.setString(9, a == null ? null : tag(a.medium(), 100));
            ps.setString(10, a == null ? null : tag(a.campaign(), 100));
            if (userId == null) ps.setNull(11, java.sql.Types.BIGINT);
            else ps.setLong(11, userId);
            ps.setTimestamp(12, Timestamp.from(now));
            return ps;
        }, key);
        Number id = key.getKey();
        return id == null ? -1 : id.longValue();
    }

    public List<Dto.ContactMessage> recentContact(int limit) {
        return jdbc.query("""
                SELECT id, name, email, topic, message, reference, page, source, created_at, handled_at
                FROM contact_messages ORDER BY (handled_at IS NULL) DESC, created_at DESC, id DESC LIMIT ?""", SiteRecords::contact, limit);
    }

    public long countContact(boolean openOnly) {
        Long n = jdbc.queryForObject(openOnly ? "SELECT COUNT(*) FROM contact_messages WHERE handled_at IS NULL" : "SELECT COUNT(*) FROM contact_messages", Long.class);
        return n == null ? 0 : n;
    }

    public Optional<Dto.ContactMessage> setHandled(long id, boolean handled, Instant now) {
        int changed = jdbc.update("UPDATE contact_messages SET handled_at = ? WHERE id = ?", handled ? Timestamp.from(now) : null, id);
        if (changed == 0) return Optional.empty();
        return jdbc.query("SELECT id, name, email, topic, message, reference, page, source, created_at, handled_at FROM contact_messages WHERE id = ?",
                SiteRecords::contact, id).stream().findFirst();
    }

    private static Dto.ContactMessage contact(ResultSet rs, int i) throws SQLException {
        return new Dto.ContactMessage(rs.getLong("id"), rs.getString("name"), rs.getString("email"), rs.getString("topic"), rs.getString("message"),
                rs.getString("reference"), rs.getString("page"), rs.getString("source"), rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("handled_at") != null);
    }

    // ------------------------------------------------------------------ sign-up sources

    /** Saves where a new account came from (only non-empty tags). */
    public void recordSignup(long userId, Requests.Attribution a) {
        if (a == null || tag(a.source(), 100) == null) return;
        jdbc.update("""
                UPDATE users SET signup_source = ?, signup_medium = ?, signup_campaign = ?, signup_term = ?, signup_content = ?, signup_referrer = ?, signup_landing = ?
                WHERE id = ?""",
                tag(a.source(), 100), tag(a.medium(), 100), tag(a.campaign(), 100), tag(a.term(), 100), tag(a.content(), 100),
                tag(a.referrer(), 255), tag(a.landingPath(), 200), userId);
    }

    public Dto.Signups signups(Instant from) {
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM users WHERE created_at >= ?", Long.class, Timestamp.from(from));
        List<Dto.SignupSource> sources = jdbc.query("""
                SELECT signup_source, signup_medium, signup_campaign, COUNT(*) AS n FROM users
                WHERE created_at >= ? AND signup_source IS NOT NULL
                GROUP BY signup_source, signup_medium, signup_campaign ORDER BY n DESC, signup_source LIMIT 25""",
                (rs, i) -> new Dto.SignupSource(rs.getString(1), rs.getString(2), rs.getString(3), rs.getLong(4)), Timestamp.from(from));
        long attributed = sources.stream().mapToLong(Dto.SignupSource::count).sum();
        return new Dto.Signups(total == null ? 0 : total, attributed, sources);
    }

    // ------------------------------------------------------------------ form counts

    /** Form counts per form since a day ("2026-09-01"), from the daily "form.<form>.<event>" counters. */
    public List<Dto.FormStats> formStats(String fromDay) {
        Map<String, Map<String, Long>> byForm = new LinkedHashMap<>();
        jdbc.query("""
                SELECT counter_name, SUM(amount) FROM usage_counters
                WHERE counter_name LIKE 'form.%' AND period_key >= ? AND LENGTH(period_key) = 10
                GROUP BY counter_name ORDER BY counter_name""", rs -> {
            String[] parts = rs.getString(1).split("\\.");
            if (parts.length == 3) byForm.computeIfAbsent(parts[1], k -> new HashMap<>()).merge(parts[2], rs.getLong(2), Long::sum);
        }, fromDay);
        List<Dto.FormStats> out = new ArrayList<>();
        byForm.forEach((form, e) -> out.add(new Dto.FormStats(form, e.getOrDefault("view", 0L), e.getOrDefault("submit", 0L), e.getOrDefault("success", 0L),
                e.getOrDefault("invalid", 0L), e.getOrDefault("rejected", 0L), e.getOrDefault("failed", 0L))));
        return out;
    }

    // ------------------------------------------------------------------ arena

    public void insertVote(long userId, Long projectId, String a, String b, String winner, Instant now) {
        jdbc.update("INSERT INTO arena_votes (user_id, project_id, contender_a, contender_b, winner, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                userId, projectId, a, b, winner, Timestamp.from(now));
    }

    public long votesBy(long userId, Instant since) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM arena_votes WHERE user_id = ? AND created_at >= ?", Long.class, userId, Timestamp.from(since));
        return n == null ? 0 : n;
    }

    public long votesSince(Instant since) {
        Long n = jdbc.queryForObject("SELECT COUNT(*) FROM arena_votes WHERE created_at >= ?", Long.class, Timestamp.from(since));
        return n == null ? 0 : n;
    }

    /** Wins, losses, ties and "both bad" for every answer source, across everyone's votes. */
    public Dto.ArenaScoreboard scoreboard(long me) {
        Map<String, long[]> t = new LinkedHashMap<>(); // votes, wins, losses, ties, bothBad
        jdbc.query("SELECT contender_a, contender_b, winner, COUNT(*) FROM arena_votes GROUP BY contender_a, contender_b, winner", rs -> {
            String a = rs.getString(1);
            String b = rs.getString(2);
            String w = rs.getString(3);
            long n = rs.getLong(4);
            long[] ta = t.computeIfAbsent(a, k -> new long[5]);
            long[] tb = t.computeIfAbsent(b, k -> new long[5]);
            ta[0] += n;
            tb[0] += n;
            switch (w) {
                case "A" -> {
                    ta[1] += n;
                    tb[2] += n;
                }
                case "B" -> {
                    tb[1] += n;
                    ta[2] += n;
                }
                case "TIE" -> {
                    ta[3] += n;
                    tb[3] += n;
                }
                default -> {
                    ta[4] += n;
                    tb[4] += n;
                }
            }
        });
        List<Dto.ArenaStanding> standings = new ArrayList<>();
        t.forEach((c, v) -> standings.add(new Dto.ArenaStanding(c, v[0], v[1], v[2], v[3], v[4])));
        standings.sort((x, y) -> Double.compare(score(y), score(x)));
        Long total = jdbc.queryForObject("SELECT COUNT(*) FROM arena_votes", Long.class);
        Long mine = jdbc.queryForObject("SELECT COUNT(*) FROM arena_votes WHERE user_id = ?", Long.class, me);
        return new Dto.ArenaScoreboard(total == null ? 0 : total, mine == null ? 0 : mine, standings);
    }

    /** Win rate with ties as half a win, pulled towards 50% while there are few votes. */
    static double score(Dto.ArenaStanding s) {
        return (s.wins() + 0.5 * s.ties() + 1.0) / (s.votes() + 2.0);
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    /** A tag from a link: one line, printable, no angle brackets, at most {@code max} characters; blank → null. */
    static String tag(String s, int max) {
        if (s == null) return null;
        // Line breaks and tabs become spaces; other control characters and brackets go.
        String t = s.replaceAll("\\s+", " ").replaceAll("[\\p{Cntrl}<>\"`]", "").trim();
        if (t.length() > max) t = t.substring(0, max);
        return t.isEmpty() ? null : t;
    }
}
