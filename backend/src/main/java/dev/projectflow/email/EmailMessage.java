package dev.projectflow.email;

/**
 * One outgoing email, with a plain-text body and an HTML body saying the same thing.
 * {@code replyTo}, when set, is where replies go instead of the site's usual reply address
 * (a contact message's sender, so the operator can simply press Reply).
 *
 * <p>{@code courtesy}: a notice people can do without (a sign-in alert, "you already have an
 * account"). These stop while the day's or the month's email budget is nearly spent, so its last
 * part stays for the emails people can't do without: confirming an address, resetting a password,
 * and the notices about a changed password or a deleted account.
 */
public record EmailMessage(String to, String subject, String text, String html, String replyTo, boolean courtesy) {

    public EmailMessage(String to, String subject, String text, String html) {
        this(to, subject, text, html, null, false);
    }

    public EmailMessage(String to, String subject, String text, String html, String replyTo) {
        this(to, subject, text, html, replyTo, false);
    }

    /** The same email, as a courtesy notice. */
    public EmailMessage asCourtesy() {
        return new EmailMessage(to, subject, text, html, replyTo, true);
    }
}
