package dev.projectflow.email;

import dev.projectflow.config.AppProperties;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import org.springframework.stereotype.Component;

/**
 * The account emails: welcome and confirm, new sign-in, reset password, password changed. Each has
 * a plain-text version and a simple HTML version with the same words. Names people typed are escaped.
 */
@Component
public class AccountEmails {

    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("EEEE d MMMM yyyy, HH:mm (zzz)", Locale.ENGLISH);

    private final String siteUrl;
    private final String siteName;
    private final String contact;
    private final ZoneId zone;

    public AccountEmails(AppProperties props) {
        AppProperties.Site site = props.site();
        String url = site == null || site.url() == null || site.url().isBlank() ? "http://localhost:5174" : site.url().trim();
        this.siteUrl = url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
        this.siteName = site == null || site.name() == null || site.name().isBlank() ? "Niveloft" : site.name().trim();
        this.contact = site == null || site.contactEmail() == null ? "" : site.contactEmail().trim();
        this.zone = ZoneId.of(props.zone() == null ? "UTC" : props.zone());
    }

    /** Where the site's contact messages go (CONTACT_EMAIL), or "" when none is set. */
    public String contactAddress() {
        return contact;
    }

    public String siteUrl() {
        return siteUrl;
    }

    public EmailMessage confirm(String to, String token, boolean required) {
        String link = siteUrl + "/verify-email?token=" + token;
        String lead = required
                ? "Confirm your email address to finish creating your account. The link works for 24 hours."
                : "Your account is ready. Please confirm your email address, so we know messages reach you. The link works for 24 hours.";
        // No name here: whoever signed up typed it, and it may not be the owner of this inbox.
        return build(to, "Confirm your email for " + siteName,
                "Welcome to " + siteName + ".",
                lead,
                "Confirm my email", link,
                "If you didn’t create this account, you can ignore this email; the account can’t be used without this link.");
    }

    public EmailMessage signIn(String to, String name, Instant at, String device, String ip) {
        String when = WHEN.format(at.atZone(zone));
        return build(to, "New sign-in to your " + siteName + " account",
                "Hi " + name + ", your account was just signed in to.",
                "When: " + when + "\nDevice: " + device + "\nIP address: " + ip,
                "Not you? Reset your password", siteUrl + "/forgot-password",
                "If this was you, there’s nothing to do. If it wasn’t, reset your password now: that signs you out everywhere.")
                .asCourtesy();
    }

    public EmailMessage reset(String to, String token) {
        return build(to, "Reset your " + siteName + " password",
                "We received a request to reset the password for this address.",
                "Choose a new password with the link below. It works once, for 1 hour.",
                "Choose a new password", siteUrl + "/reset-password?token=" + token,
                "If you didn’t ask for this, ignore this email: your password stays the same.");
    }

    public EmailMessage passwordChanged(String to, String name, Instant at) {
        return build(to, "Your " + siteName + " password was changed",
                "Hi " + name + ", your password was changed on " + WHEN.format(at.atZone(zone)) + ".",
                "Every other device was signed out.",
                "Sign in", siteUrl + "/login",
                "If you didn’t do this, reset your password straight away with “Forgot password?” on the sign-in page.");
    }

    /** Someone tried to create an account with an address that already has one (the sign-up page doesn't say so). */
    public EmailMessage alreadyRegistered(String to, String name) {
        return build(to, "Someone tried to create a " + siteName + " account with your address",
                "Hi " + name + ", someone just tried to create a new account with this email address, which already has one.",
                "If it was you, sign in instead, or choose a new password if you’ve forgotten it.",
                "Sign in", siteUrl + "/login",
                "If it wasn’t you, there’s nothing to do: no new account was created and yours hasn’t changed.")
                .asCourtesy();
    }

    /** The account was deleted; sent to the address it had, before it was removed. */
    public EmailMessage accountDeleted(String to, String name, Instant at) {
        return build(to, "Your " + siteName + " account was deleted",
                "Hi " + name + ", your account was deleted on " + WHEN.format(at.atZone(zone)) + ".",
                "Your name, email address and password were removed and every device was signed out. What you wrote in projects you shared "
                        + "(comments, submissions, reviews) stays with those projects, shown as by a deleted user.",
                "Create a new account", siteUrl + "/register",
                "If you didn’t do this, reply to this email or contact the people who run this copy of " + siteName + " straight away.");
    }

    /** A message from the site's Contact form, to the operator. Replying answers the sender. */
    public EmailMessage contactReceived(String to, String name, String fromEmail, String topic, String message, String reference, String page) {
        String details = "From: " + name + " <" + fromEmail + ">\nAbout: " + topic
                + (page == null || page.isBlank() ? "" : "\nWritten on: " + page)
                + (reference == null || reference.isBlank() ? "" : "\nError reference: " + reference)
                + "\n\n" + message;
        EmailMessage m = build(to, "[" + siteName + "] " + topic + " from " + name,
                "A message arrived through the Contact form.",
                details,
                "Open Site health", siteUrl + "/site-health",
                "Reply to this email to answer " + name + " directly. The message is also saved on the Site health page.");
        return new EmailMessage(m.to(), m.subject(), m.text(), m.html(), fromEmail);
    }

    private EmailMessage build(String to, String subject, String greeting, String body, String action, String link, String note) {
        String footer = siteName + " · " + siteUrl + (contact.isEmpty() ? "" : " · " + contact);
        String text = greeting + "\n\n" + body + "\n\n" + action + ":\n" + link + "\n\n" + note + "\n\n— " + footer + "\n";
        String html = """
                <!doctype html><html><body style="margin:0;padding:24px;background:#f4f3f0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1b19">
                <table role="presentation" width="100%%" style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #dcd9d2">
                <tr><td style="padding:28px 28px 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6b675f">%s</td></tr>
                <tr><td style="padding:4px 28px 0;font-size:18px;line-height:1.4">%s</td></tr>
                <tr><td style="padding:12px 28px 0;font-size:14px;line-height:1.6;color:#3d3a35">%s</td></tr>
                <tr><td style="padding:24px 28px"><a href="%s" style="display:inline-block;background:#1c1b19;color:#ffffff;text-decoration:none;padding:12px 18px;font-size:14px">%s</a></td></tr>
                <tr><td style="padding:0 28px 8px;font-size:12px;line-height:1.6;color:#6b675f">If the button doesn’t work, copy this link:<br><span style="word-break:break-all">%s</span></td></tr>
                <tr><td style="padding:8px 28px 24px;font-size:12px;line-height:1.6;color:#6b675f">%s</td></tr>
                </table>
                <p style="max-width:520px;margin:12px auto 0;font-size:11px;color:#6b675f;text-align:center">%s</p>
                </body></html>
                """.formatted(esc(siteName), esc(greeting), esc(body).replace("\n", "<br>"), esc(link), esc(action), esc(link), esc(note), esc(footer));
        return new EmailMessage(to, subject, text, html);
    }

    static String esc(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;");
    }
}
