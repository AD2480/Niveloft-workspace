package dev.projectflow.service;

import dev.projectflow.config.ProductionGuard;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * Niveloft no longer has demo data, but a database seeded by an earlier version still holds its
 * accounts, and their shared password was published. At start-up a production server suspends
 * them (each is recorded in the audit log), so nobody can sign in as them; a development server
 * only says they're there.
 */
@Component
public class RetiredDemoAccounts implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(RetiredDemoAccounts.class);

    private final AccountService accounts;
    private final ProductionGuard guard;

    public RetiredDemoAccounts(AccountService accounts, ProductionGuard guard) {
        this.accounts = accounts;
        this.guard = guard;
    }

    @Override
    public void run(ApplicationArguments args) {
        boolean production = guard.production();
        List<String> found = accounts.retireDemoAccounts(production);
        String message = message(found, production);
        if (message != null) log.warn(message);
    }

    /** What to tell the operator about the accounts found, or null when there are none. */
    static String message(List<String> emails, boolean suspended) {
        if (emails == null || emails.isEmpty()) return null;
        String list = String.join(", ", emails.stream().limit(8).toList()) + (emails.size() > 8 ? ", …" : "");
        return suspended
                ? "Suspended " + emails.size() + " account(s) left from the retired demo data (" + list + "): their password was published, "
                        + "so they can no longer sign in. Nothing else is needed; they stay suspended."
                : "This database holds " + emails.size() + " account(s) from the retired demo data (" + list + "), whose password was published. "
                        + "A production server suspends them at start-up. To start a local database empty: docker compose down -v.";
    }
}
