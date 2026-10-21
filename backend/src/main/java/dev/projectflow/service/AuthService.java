package dev.projectflow.service;

import dev.projectflow.site.SiteRecords;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import dev.projectflow.config.AppProperties;
import dev.projectflow.domain.AccountToken;
import dev.projectflow.domain.User;
import dev.projectflow.email.AccountEmails;
import dev.projectflow.email.EmailService;
import dev.projectflow.live.LiveUpdateService;
import dev.projectflow.ops.AuditLog;
import dev.projectflow.ops.OpsSwitches;
import dev.projectflow.repository.AccountTokenRepository;
import dev.projectflow.repository.UserRepository;
import dev.projectflow.security.AuthUser;
import dev.projectflow.security.ClientInfo;
import dev.projectflow.security.CurrentUser;
import dev.projectflow.security.HumanCheck;
import dev.projectflow.security.JwtService;
import dev.projectflow.security.PasswordPolicy;
import dev.projectflow.security.RateLimiter;
import dev.projectflow.security.SessionStore;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import dev.projectflow.web.error.ApiException;
import dev.projectflow.web.error.ErrorCode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Registration, sign-in, emailed links (confirm the address, reset the password) and account
 * settings. Passwords are stored as BCrypt hashes; emailed links are stored as SHA-256 hashes.
 *
 * <p>Bots and guessing are slowed by per-address and per-account limits, a honeypot field and,
 * when configured, Cloudflare Turnstile. Answers never reveal whether an email has an account.
 * At registration that holds when addresses must be confirmed (the existing account's owner gets an
 * email instead); without confirmation a new account is signed in at once, so "already registered"
 * is the only possible answer there.
 *
 * <p>Every sign-in is a server-side session ({@link SessionStore}); signing out, a password change or
 * reset, suspension and deletion end sessions at once.
 */
@Service
public class AuthService {

    static final List<String> PALETTE = List.of("#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#14b8a6", "#f97316", "#64748b");
    static final Duration VERIFY_TTL = Duration.ofHours(24);
    static final Duration RESET_TTL = Duration.ofHours(1);

    private final UserRepository users;
    private final AccountTokenRepository tokens;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    private final DtoMapper mapper;
    private final Clock clock;
    private final EmailService email;
    private final AccountEmails emails;
    private final RateLimiter limits;
    private final HumanCheck human;
    private final LiveUpdateService live;
    private final SessionStore sessions;
    private final PasswordPolicy passwords;
    private final AuditLog audit;
    private final OpsSwitches switches;
    private final boolean verificationRequired;
    private final boolean registrationOpen;
    private final boolean signInAlerts;
    private final SecureRandom random = new SecureRandom();
    /** Compared against when the email is unknown, so response time doesn't reveal which emails exist. */
    private final String dummyHash;

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    private final SiteRecords site;

    public AuthService(UserRepository users, AccountTokenRepository tokens, PasswordEncoder encoder, JwtService jwt, DtoMapper mapper, Clock clock,
                       EmailService email, AccountEmails emails, RateLimiter limits, HumanCheck human, LiveUpdateService live, AppProperties props,
                       SiteRecords site, SessionStore sessions, PasswordPolicy passwords, AuditLog audit, OpsSwitches switches) {
        this.site = site;
        this.sessions = sessions;
        this.passwords = passwords;
        this.audit = audit;
        this.switches = switches;
        this.users = users;
        this.tokens = tokens;
        this.encoder = encoder;
        this.jwt = jwt;
        this.mapper = mapper;
        this.clock = clock;
        this.email = email;
        this.emails = emails;
        this.limits = limits;
        this.human = human;
        this.live = live;
        AppProperties.Accounts accounts = props.accounts();
        String rule = accounts == null || accounts.requireEmailVerification() == null ? "auto" : accounts.requireEmailVerification().trim().toLowerCase();
        this.verificationRequired = switch (rule) {
            case "true", "yes", "on" -> true;
            case "false", "no", "off" -> false;
            default -> email.delivers(); // auto: only when emails can actually arrive
        };
        if (verificationRequired && !email.enabled()) {
            throw new IllegalStateException("REQUIRE_EMAIL_VERIFICATION=true needs email: set EMAIL_PROVIDER to resend (or log for local testing).");
        }
        this.registrationOpen = accounts == null || accounts.open();
        this.signInAlerts = props.email() == null || props.email().alertsOnSignIn();
        this.dummyHash = encoder.encode("projectflow-timing-dummy");
    }

    public Dto.AuthOptions options() {
        return new Dto.AuthOptions(registrationOpen && switches.on("signups"), email.delivers(), verificationRequired, email.enabled(), human.turnstileEnabled(),
                sessions.policy().rememberDaysOrDefault());
    }

    /**
     * A sign-in: what the app gets (its token lives only in the tab), and the value of the "keep me
     * signed in" cookie, which only the browser keeps (HttpOnly; null when the sign-in isn't kept,
     * and then any earlier cookie is removed). The cookie's value never appears in a response body.
     */
    public record SignIn(Dto.AuthResponse response, String cookie, Instant expires) {}

    /** Opens a session for this sign-in and returns its token, and its cookie if it's kept. */
    private SignIn tokenFor(User u, boolean remember, ClientInfo client, String how) {
        SessionStore.Session s = sessions.open(u.getId(), remember, client == null ? null : client.device(), client == null ? null : client.ip());
        audit.record(u.getId(), null, "auth.signed_in", "session " + s.id(), AuditLog.OK, how + (s.remember() ? ", kept signed in" : ""));
        return new SignIn(token(u, s), sessions.newCookie(s), s.expiresAt());
    }

    /** A sign-in token for a session: valid until the session ends, or JWT_EXPIRATION_SECONDS if sooner. */
    private Dto.AuthResponse token(User u, SessionStore.Session s) {
        long seconds = Math.max(1, java.time.Duration.between(Instant.now(clock), s.expiresAt()).getSeconds());
        return new Dto.AuthResponse(jwt.issue(u.getId(), u.getEmail(), s.publicId(), s.expiresAt()), "Bearer", Math.min(seconds, jwt.expirationSeconds()),
                mapper.user(u), false, u.getEmail());
    }

    /**
     * "Keep me signed in": a new token for the kept sign-in this cookie belongs to, for a tab opened
     * later or a token that has expired. Empty when the cookie doesn't match an active kept session
     * (signed out, expired, revoked, a changed password), or the account is suspended or deleted.
     * The session stays the same one, so ending it in Settings ends this too.
     */
    @Transactional
    public java.util.Optional<Dto.AuthResponse> refresh(String cookie, ClientInfo client) {
        limits.check("refresh-ip", client.limitKey(), 300, Duration.ofHours(1));
        return sessions.fromCookie(cookie).flatMap(s -> users.findById(s.userId())
                .filter(u -> u.getSuspendedAt() == null && u.getDeletedAt() == null)
                .map(u -> {
                    sessions.touch(s);
                    return token(u, s);
                }));
    }

    // ------------------------------------------------------------------ sign-up and sign-in

    @Transactional
    public SignIn register(Requests.Register req, ClientInfo client) {
        if (!registrationOpen) {
            throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.NOT_AVAILABLE, "New accounts can’t be created on this server right now.", null);
        }
        switches.require("signups");
        // Generous per address: a class behind one campus network shares an IP.
        limits.check("register-ip", client.limitKey(), 20, Duration.ofHours(1));
        human.require(req.website(), req.captchaToken(), client.ip());
        requireBcryptLength(req.password(), "password");
        String address = req.email().trim().toLowerCase();
        passwords.check(req.password(), address, req.name(), "password");
        User existing = users.findByEmailIgnoreCase(address).orElse(null);
        if (existing != null) {
            if (verificationRequired) {
                // The same answer as a new account, so sign-up can't be used to find out who has one.
                // The owner hears about it, at most a few times an hour.
                encoder.encode(req.password()); // the same work as creating an account
                if (email.enabled() && existing.getDeletedAt() == null) {
                    try {
                        limits.check("already-registered", String.valueOf(existing.getId()), 3, Duration.ofHours(1));
                        email.send(emails.alreadyRegistered(existing.getEmail(), existing.getName()));
                    } catch (ApiException overLimit) {
                        // at most 3 such emails an hour; the answer stays the same
                    }
                }
                return new SignIn(Dto.AuthResponse.pendingVerification(address), null, null);
            }
            throw ApiException.conflict("An account with this email already exists. Sign in, or use “Forgot password?”.", "email");
        }
        Instant now = Instant.now(clock);
        User u = new User();
        u.setName(req.name().trim());
        u.setEmail(address);
        u.setPasswordHash(encoder.encode(req.password()));
        u.setAvatarColor(PALETTE.get((int) (users.count() % PALETTE.size())));
        u.setCreatedAt(now);
        u.setTermsAcceptedAt(now);
        users.save(u);
        // Which campaign brought them (UTM tags), for the operator's sign-up sources. Never blocks a sign-up.
        try {
            site.recordSignup(u.getId(), req.attribution());
        } catch (RuntimeException e) {
            log.warn("Couldn't save the sign-up source: {}", e.getMessage());
        }
        if (email.enabled()) {
            email.send(emails.confirm(u.getEmail(), newToken(u, AccountToken.Purpose.VERIFY_EMAIL, VERIFY_TTL), verificationRequired));
        }
        audit.record(u.getId(), null, "account.created", null, AuditLog.OK, verificationRequired ? "waiting for email confirmation" : null);
        return verificationRequired ? new SignIn(Dto.AuthResponse.pendingVerification(u.getEmail()), null, null) : tokenFor(u, false, client, "new account");
    }

    @Transactional
    public SignIn login(Requests.Login req, ClientInfo client) {
        String address = req.email().trim().toLowerCase();
        // Only wrong passwords count: 30 from one address in 15 minutes, and 10 for one account from
        // one address. There's deliberately no account-wide limit across addresses: anyone could use
        // it to lock a chosen person out. Distributed guessing is still capped per address, and each
        // guess costs a BCrypt comparison.
        String here = client.limitKey() + "|" + address;
        limits.ensureUnder("login-fail-ip", client.limitKey(), 30, Duration.ofMinutes(15));
        limits.ensureUnder("login-fail", here, 10, Duration.ofMinutes(15));
        User u = users.findByEmailIgnoreCase(address).orElse(null);
        // Same message and a hash comparison either way, so emails can't be probed by response time.
        boolean ok = encoder.matches(req.password(), u == null ? dummyHash : u.getPasswordHash());
        if (u == null || !ok) {
            limits.record("login-fail-ip", client.limitKey(), Duration.ofMinutes(15));
            limits.record("login-fail", here, Duration.ofMinutes(15));
            throw ApiException.unauthorized("Invalid email or password.");
        }
        limits.clear("login-fail", here);
        if (u.getSuspendedAt() != null) {
            audit.record(u.getId(), null, "auth.signed_in", null, AuditLog.DENIED, "account suspended");
            throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.ACCOUNT_SUSPENDED,
                    "This account is suspended, so it can’t sign in. If you think that’s a mistake, contact the people who run this copy of Niveloft.", null);
        }
        if (verificationRequired && !u.isEmailVerified()) {
            throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.EMAIL_NOT_VERIFIED,
                    "Please confirm your email address first: use the link we sent to " + u.getEmail() + ", or send a new one below.", null);
        }
        // Only to confirmed addresses: an unconfirmed one might belong to someone else.
        if (signInAlerts && email.enabled() && u.isEmailVerified()) {
            email.send(emails.signIn(u.getEmail(), u.getName(), Instant.now(clock), client.device(), client.ip()));
        }
        return tokenFor(u, Boolean.TRUE.equals(req.remember()), client, "password");
    }

    // ------------------------------------------------------------------ emailed links

    /**
     * Confirms the address. It deliberately doesn't sign anyone in: if someone registered this
     * address before its owner did, the owner still has to sign in, can't, and resets the password,
     * which ends the other person's access.
     */
    @Transactional
    public Dto.VerifiedEmail verifyEmail(Requests.VerifyEmail req) {
        AccountToken t = tokens.findByTokenHash(hash(req.token().trim())).orElse(null);
        Instant now = Instant.now(clock);
        if (t == null || t.getPurpose() != AccountToken.Purpose.VERIFY_EMAIL) throw linkExpired("This confirmation link isn’t valid. Send yourself a new one from the sign-in page.");
        User u = users.findById(t.getUserId()).orElseThrow(() -> linkExpired("This account no longer exists."));
        if (!t.usableAt(now) || tokens.markUsed(t.getId(), now) == 0) {
            if (u.isEmailVerified()) throw linkExpired("Your email address is already confirmed. You can sign in.");
            throw linkExpired("This confirmation link has expired or was already used. Send yourself a new one from the sign-in page.");
        }
        tokens.retireAll(u.getId(), AccountToken.Purpose.VERIFY_EMAIL, now);
        if (!u.isEmailVerified()) u.setEmailVerifiedAt(now);
        return new Dto.VerifiedEmail(u.getEmail());
    }

    /** Sends a new confirmation link if the account exists and isn't confirmed. The answer is the same either way. */
    @Transactional
    public String resendVerification(Requests.EmailLinkRequest req, ClientInfo client) {
        requireEmail("Confirmation emails");
        limits.check("link-ip", client.limitKey(), 20, Duration.ofHours(1));
        human.require(req.website(), req.captchaToken(), client.ip());
        users.findByEmailIgnoreCase(req.email().trim()).filter(u -> !u.isEmailVerified()).ifPresent(u -> {
            if (underAccountLimit(u, AccountToken.Purpose.VERIFY_EMAIL)) {
                email.send(emails.confirm(u.getEmail(), newToken(u, AccountToken.Purpose.VERIFY_EMAIL, VERIFY_TTL), verificationRequired));
            }
        });
        return "If that address has an account waiting for confirmation, a new link is on its way. Check your inbox and spam folder.";
    }

    @Transactional
    public String forgotPassword(Requests.EmailLinkRequest req, ClientInfo client) {
        requireEmail("Password reset");
        limits.check("link-ip", client.limitKey(), 20, Duration.ofHours(1));
        human.require(req.website(), req.captchaToken(), client.ip());
        users.findByEmailIgnoreCase(req.email().trim()).ifPresent(u -> {
            if (underAccountLimit(u, AccountToken.Purpose.RESET_PASSWORD)) {
                email.send(emails.reset(u.getEmail(), newToken(u, AccountToken.Purpose.RESET_PASSWORD, RESET_TTL)));
            }
        });
        return "If that address has an account, a link to choose a new password is on its way. It works for 1 hour. Check your spam folder too.";
    }

    @Transactional
    public String resetPassword(Requests.ResetPassword req, ClientInfo client) {
        limits.check("reset-ip", client.limitKey(), 20, Duration.ofHours(1));
        requireBcryptLength(req.password(), "password");
        AccountToken t = tokens.findByTokenHash(hash(req.token().trim())).orElse(null);
        Instant now = Instant.now(clock);
        if (t == null || t.getPurpose() != AccountToken.Purpose.RESET_PASSWORD || !t.usableAt(now)) {
            throw linkExpired("This reset link has expired or was already used. Ask for a new one.");
        }
        User u = users.findById(t.getUserId()).filter(x -> x.getDeletedAt() == null).orElseThrow(() -> linkExpired("This account no longer exists."));
        // Before using up the link, so a refused password can be replaced with another one.
        passwords.check(req.password(), u.getEmail(), u.getName(), "password");
        if (tokens.markUsed(t.getId(), now) == 0) throw linkExpired("This reset link has expired or was already used. Ask for a new one.");
        tokens.retireEverything(u.getId(), now); // no older link (confirm or reset) works any more
        u.setPasswordHash(encoder.encode(req.password()));
        u.bumpSessionVersion();
        sessions.revokeAll(u.getId(), "password-reset", null); // signs out every device, including whoever else had the password
        if (!u.isEmailVerified()) u.setEmailVerifiedAt(now); // the link proved they read this inbox
        live.endSessions(u.getId());
        audit.record(u.getId(), null, "auth.password_reset", null, AuditLog.OK, "every session ended");
        email.send(emails.passwordChanged(u.getEmail(), u.getName(), now));
        return "Your password was changed and every device was signed out. Sign in with the new password.";
    }

    /** BCrypt only uses a password's first 72 bytes (and Spring refuses longer ones to be safe). */
    static void requireBcryptLength(String password, String field) {
        if (password != null && password.getBytes(StandardCharsets.UTF_8).length > 72) {
            throw ApiException.validation(field, "Password is too long: at most 72 bytes (fewer characters if it has accents or emoji).");
        }
    }

    private void requireEmail(String what) {
        if (!email.enabled()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, ErrorCode.NOT_AVAILABLE,
                    what + " can’t be sent: this server has no email set up. Ask whoever runs it for help.", null);
        }
    }

    /** At most 3 links of a kind per account per hour, whoever asks. */
    private boolean underAccountLimit(User u, AccountToken.Purpose purpose) {
        return tokens.countByUserIdAndPurposeAndCreatedAtAfter(u.getId(), purpose, Instant.now(clock).minus(Duration.ofHours(1))) < 3;
    }

    private String newToken(User u, AccountToken.Purpose purpose, Duration ttl) {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant now = Instant.now(clock);
        AccountToken t = new AccountToken();
        t.setUserId(u.getId());
        t.setPurpose(purpose);
        t.setTokenHash(hash(token));
        t.setCreatedAt(now);
        t.setExpiresAt(now.plus(ttl));
        tokens.save(t);
        return token;
    }

    static String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static ApiException linkExpired(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, ErrorCode.LINK_EXPIRED, message, null);
    }

    /** Removes links that expired more than a week ago. */
    @Scheduled(cron = "0 17 3 * * *")
    @Transactional
    public void purgeExpiredLinks() {
        tokens.deleteExpiredBefore(Instant.now(clock).minus(Duration.ofDays(7)));
    }

    // ------------------------------------------------------------------ the signed-in account

    private User me() {
        return users.findById(CurrentUser.id()).orElseThrow(() -> ApiException.unauthorized("Your session has expired. Please sign in again."));
    }

    @Transactional(readOnly = true)
    public Dto.User currentUser() {
        return mapper.user(me());
    }

    @Transactional
    public Dto.User updateProfile(Requests.UpdateProfile req) {
        User u = me();
        u.setName(req.name().trim());
        u.setJobTitle(req.jobTitle() == null || req.jobTitle().isBlank() ? null : req.jobTitle().trim());
        u.setAvatarColor(req.avatarColor());
        return mapper.user(u);
    }

    /**
     * Changes the password, signs out every device, and returns a new session for this one (a new
     * session id after a credential change). Wrong current passwords count like failed sign-ins.
     */
    @Transactional
    public SignIn changePassword(Requests.ChangePassword req, ClientInfo client) {
        User u = me();
        String here = client.limitKey() + "|" + u.getEmail();
        limits.ensureUnder("login-fail", here, 10, Duration.ofMinutes(15));
        if (!encoder.matches(req.currentPassword(), u.getPasswordHash())) {
            limits.record("login-fail", here, Duration.ofMinutes(15));
            throw ApiException.validation("currentPassword", "Current password is incorrect.");
        }
        if (req.currentPassword().equals(req.newPassword())) {
            throw ApiException.validation("newPassword", "New password must be different from the current one.");
        }
        requireBcryptLength(req.newPassword(), "newPassword");
        passwords.check(req.newPassword(), u.getEmail(), u.getName(), "newPassword");
        boolean remember = sessions.find(CurrentUser.sessionId()).map(SessionStore.Session::remember).orElse(false);
        u.setPasswordHash(encoder.encode(req.newPassword()));
        u.bumpSessionVersion();
        sessions.revokeAll(u.getId(), "password-changed", null);
        tokens.retireEverything(u.getId(), Instant.now(clock));
        live.endSessions(u.getId());
        audit.record(u.getId(), null, "auth.password_changed", null, AuditLog.OK, "every session ended");
        if (email.enabled() && u.isEmailVerified()) email.send(emails.passwordChanged(u.getEmail(), u.getName(), Instant.now(clock)));
        return tokenFor(u, remember, client, "after a password change");
    }

    // ------------------------------------------------------------------ sessions

    /**
     * Signs this browser out: this tab's session ends on the server, so its token stops working
     * everywhere it was copied, and so does the browser's kept sign-in ({@code keptCookie}, the
     * "keep me signed in" cookie that came with the request) when it's the same account's. Without a
     * usable token (it expired, say), the cookie alone ends its own session: the controller passes it
     * only when the request comes from the app. Returns false when there was nothing to sign out.
     */
    @Transactional
    public boolean logout(String keptCookie) {
        AuthUser user = CurrentUser.orNull();
        Long me = user == null ? null : user.id();
        String sid = user == null ? null : user.sessionId();
        if (sid != null && sessions.revokeByPublicId(me, sid, "signed-out")) {
            audit.record(me, null, "auth.signed_out", null, AuditLog.OK, null);
        }
        java.util.Optional<SessionStore.Session> kept = sessions.fromCookie(keptCookie)
                .filter(s -> me == null || s.userId() == me)
                .filter(s -> !s.publicId().equals(sid));
        kept.filter(s -> sessions.revokeByPublicId(s.userId(), s.publicId(), "signed-out"))
                .ifPresent(s -> audit.record(s.userId(), null, "auth.signed_out", "session " + s.id(), AuditLog.OK,
                        me == null ? "kept sign-in, by its cookie" : "kept sign-in on the same browser"));
        return user != null || kept.isPresent();
    }

    /** Signs every device out, this one included. */
    @Transactional
    public int logoutEverywhere() {
        Long me = CurrentUser.id();
        int ended = sessions.revokeAll(me, "signed-out-everywhere", null);
        live.endSessions(me);
        audit.record(me, null, "auth.signed_out_everywhere", null, AuditLog.OK, ended + " session(s) ended");
        return ended;
    }

    @Transactional(readOnly = true)
    public List<Dto.SessionInfo> mySessions() {
        Long me = CurrentUser.id();
        String current = CurrentUser.sessionId();
        return sessions.active(me).stream()
                .map(s -> new Dto.SessionInfo(s.id(), s.device(), s.network(), s.createdAt(), s.lastSeenAt(), s.expiresAt(), s.remember(), s.publicId().equals(current)))
                .toList();
    }

    /** Ends one of my sessions (another device, usually). */
    @Transactional
    public void endSession(long sessionId) {
        Long me = CurrentUser.id();
        if (!sessions.revoke(me, sessionId, "ended-by-owner")) throw ApiException.notFound("That session has already ended.");
        live.endSessions(me); // other devices' live updates reconnect with their own (still valid) sessions
        audit.record(me, null, "auth.session_ended", "session " + sessionId, AuditLog.OK, null);
    }
}
