package dev.projectflow.service;

import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Searching a project's approved documents for Flurry: passages that contain the query's words,
 * ranked with BM25 (words that are rarer in the project count for more; a match in a heading or
 * the title counts double). Only documents an owner or manager approved are read, and only the
 * project asked about. This is word search, not meaning: "sign-in" won't find "log in" unless both
 * are written. It's enough for team-sized projects; the eval would show when it isn't.
 */
@Service
public class DocumentSearch {

    static final int MAX_WORDS = 8;
    static final int MAX_CANDIDATES = 2_000;
    private static final double K1 = 1.2, B = 0.75;

    public record Hit(long passageId, long documentId, String title, String heading, String content, double score) {}

    record Candidate(long passageId, long documentId, String title, String heading, String content) {}

    private final JdbcTemplate jdbc;

    public DocumentSearch(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Hit> search(Long projectId, String query, int limit) {
        List<String> words = DocumentText.queryWords(query, MAX_WORDS);
        if (words.isEmpty()) return List.of();
        StringBuilder sql = new StringBuilder("SELECT p.id, p.document_id, d.title, p.heading, p.content FROM document_passages p JOIN project_documents d ON d.id = p.document_id "
                + "WHERE p.project_id = ? AND d.status = 'APPROVED' AND (");
        List<Object> args = new ArrayList<>();
        args.add(projectId);
        for (int i = 0; i < words.size(); i++) {
            if (i > 0) sql.append(" OR ");
            sql.append("LOWER(p.content) LIKE ? OR LOWER(COALESCE(p.heading, '')) LIKE ? OR LOWER(d.title) LIKE ?");
            String like = "%" + words.get(i).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
            args.add(like);
            args.add(like);
            args.add(like);
        }
        sql.append(") ORDER BY p.id LIMIT ").append(MAX_CANDIDATES);
        List<Candidate> found = jdbc.query(sql.toString(), (rs, i) -> new Candidate(rs.getLong(1), rs.getLong(2), rs.getString(3), rs.getString(4), rs.getString(5)), args.toArray());
        Integer total = jdbc.queryForObject("SELECT COUNT(*) FROM document_passages p JOIN project_documents d ON d.id = p.document_id WHERE p.project_id = ? AND d.status = 'APPROVED'",
                Integer.class, projectId);
        return rank(found, words, total == null ? found.size() : total, limit);
    }

    /** BM25 over the candidates; {@code total} is how many approved passages the project has (for how rare a word is). */
    static List<Hit> rank(List<Candidate> found, List<String> words, int total, int limit) {
        if (found.isEmpty()) return List.of();
        List<List<String>> docs = new ArrayList<>();
        double avg = 0;
        for (Candidate c : found) {
            List<String> w = new ArrayList<>(DocumentText.words(c.content()));
            // A heading or title match counts twice: once in the text, once more here.
            List<String> head = DocumentText.words((c.heading() == null ? "" : c.heading()) + " " + c.title());
            w.addAll(head);
            w.addAll(head);
            docs.add(w);
            avg += w.size();
        }
        avg = Math.max(1, avg / found.size());
        Map<String, Integer> df = new HashMap<>();
        for (List<String> d : docs) for (String w : new HashSet<>(d)) if (words.contains(w)) df.merge(w, 1, Integer::sum);
        int n = Math.max(total, found.size());
        List<Hit> hits = new ArrayList<>();
        for (int i = 0; i < found.size(); i++) {
            List<String> d = docs.get(i);
            Map<String, Integer> tf = new HashMap<>();
            for (String w : d) if (words.contains(w)) tf.merge(w, 1, Integer::sum);
            double score = 0;
            for (String w : words) {
                int f = tf.getOrDefault(w, 0);
                if (f == 0) continue;
                int dfw = df.getOrDefault(w, 0);
                double idf = Math.log(1 + (n - dfw + 0.5) / (dfw + 0.5));
                score += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * d.size() / avg));
            }
            Candidate c = found.get(i);
            if (score > 0) hits.add(new Hit(c.passageId(), c.documentId(), c.title(), c.heading(), c.content(), score));
        }
        hits.sort(Comparator.comparingDouble(Hit::score).reversed().thenComparingLong(Hit::passageId));
        return hits.subList(0, Math.min(limit, hits.size()));
    }
}
