package dev.projectflow.security;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import dev.projectflow.config.ProductionGuard;
import java.time.Clock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Where rate-limit counts live ({@code RATE_LIMIT_STORE}): {@code database} (shared by every API
 * instance, so limits hold however many servers run), {@code memory} (this server only; fine for a
 * single instance and for development), or {@code auto}, the default: the database in production,
 * memory elsewhere. The database store gets its own small connection pool
 * ({@code RATE_LIMIT_DB_POOL}, 3) so counting never waits on, or holds, the application's
 * connections.
 */
@Configuration
public class RateCountsConfig {

    private static final Logger log = LoggerFactory.getLogger(RateCountsConfig.class);

    @Bean
    public RateCounts rateCounts(@Value("${projectflow.rate-limits.store:auto}") String store,
                                 @Value("${projectflow.rate-limits.database-pool:3}") int pool,
                                 ProductionGuard guard, ObjectProvider<DataSourceProperties> dataSources, Clock clock) {
        DataSourceProperties db = dataSources.getIfAvailable();
        if ("database".equals(RateCounts.store(store, guard.production())) && db != null) {
            HikariConfig config = new HikariConfig();
            config.setPoolName("rate-limits");
            config.setJdbcUrl(db.determineUrl());
            config.setUsername(db.determineUsername());
            config.setPassword(db.determinePassword());
            String driver = db.determineDriverClassName();
            if (driver != null && !driver.isBlank()) config.setDriverClassName(driver);
            config.setMaximumPoolSize(Math.max(1, Math.min(pool, 20)));
            config.setMinimumIdle(1);
            config.setAutoCommit(true);
            // Fail fast while counting (the counts fall back to memory), and don't stop the server starting.
            config.setConnectionTimeout(2_000);
            config.setInitializationFailTimeout(-1);
            log.info("Rate limits: counted in the database, shared by every API instance.");
            return new DatabaseRateCounts(new HikariDataSource(config), clock);
        }
        log.info("Rate limits: counted in this server's memory (enough for one API instance; set RATE_LIMIT_STORE=database for more).");
        return new MemoryRateCounts(clock);
    }
}
