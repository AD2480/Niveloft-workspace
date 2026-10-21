package dev.projectflow.email;

import static org.assertj.core.api.Assertions.assertThat;

import dev.projectflow.config.AppProperties;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class AccountEmailsTest {

    private final AccountEmails emails = new AccountEmails(new AppProperties("Asia/Kolkata", null, null, null, null,
            new AppProperties.Site("https://pf.example.app/", "ProjectFlow", "help@pf.example"), null, null, null, null));

    @Test
    void linksPointAtTheSiteAndNamesAreEscaped() {
        EmailMessage m = emails.confirm("a@b.co", "T0K3N", true);
        assertThat(m.text()).contains("https://pf.example.app/verify-email?token=T0K3N");
        // The confirmation email carries no name: whoever signed up typed it.
        assertThat(m.text()).startsWith("Welcome to ProjectFlow.");
        EmailMessage alert = emails.signIn("a@b.co", "<b>Asha</b>", Instant.parse("2026-09-27T05:30:00Z"), "Chrome on macOS", "1.2.3.4");
        assertThat(alert.html()).contains("&lt;b&gt;Asha&lt;/b&gt;").doesNotContain("<b>Asha");
    }

    @Test
    void signInAlertUsesTheSiteTimeZone() {
        EmailMessage m = emails.signIn("a@b.co", "Asha", Instant.parse("2026-09-27T05:30:00Z"), "Chrome on macOS", "203.0.113.9");
        assertThat(m.text()).contains("Sunday 27 September 2026, 11:00").contains("Chrome on macOS").contains("203.0.113.9");
        assertThat(m.text()).contains("https://pf.example.app/forgot-password");
    }
}
