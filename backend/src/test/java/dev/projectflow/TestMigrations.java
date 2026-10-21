package dev.projectflow;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

/** The Flyway migrations run by hand on a test database (H2 in MySQL mode), in version order. */
public final class TestMigrations {

    private TestMigrations() {}

    public static int version(Resource r) {
        Matcher m = Pattern.compile("^V(\\d+)__").matcher(String.valueOf(r.getFilename()));
        return m.find() ? Integer.parseInt(m.group(1)) : Integer.MAX_VALUE;
    }

    /** A migration's statements (comment lines dropped), as Flyway runs them. */
    public static List<String> statements(String sql) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        for (String line : sql.split("\n")) {
            String t = line.strip();
            if (t.startsWith("--") || t.isEmpty()) continue;
            cur.append(line).append('\n');
            if (t.endsWith(";")) {
                String s = cur.toString().strip();
                out.add(s.substring(0, s.length() - 1));
                cur.setLength(0);
            }
        }
        if (!cur.toString().isBlank()) out.add(cur.toString());
        return out;
    }

    /** Runs every migration on the connection, then switches foreign-key checks off so tests needn't create parent rows. */
    public static void applyLoose(Connection c) throws Exception {
        Resource[] scripts = new PathMatchingResourcePatternResolver().getResources("classpath:db/migration/V*.sql");
        Arrays.sort(scripts, Comparator.comparingInt(TestMigrations::version));
        try (Statement st = c.createStatement()) {
            for (Resource r : scripts) for (String sql : statements(r.getContentAsString(StandardCharsets.UTF_8))) st.execute(sql);
            st.execute("SET REFERENTIAL_INTEGRITY FALSE");
        }
    }
}
