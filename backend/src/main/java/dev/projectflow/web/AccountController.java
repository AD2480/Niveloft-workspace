package dev.projectflow.web;

import dev.projectflow.config.AppProperties;
import dev.projectflow.security.ClientInfo;
import dev.projectflow.security.CurrentUser;
import dev.projectflow.security.SessionCookie;
import dev.projectflow.service.AccountService;
import dev.projectflow.service.AuthService;
import dev.projectflow.service.CatchUpService;
import dev.projectflow.service.InsightService;
import dev.projectflow.service.SearchService;
import dev.projectflow.web.dto.Dto;
import dev.projectflow.web.dto.Requests;
import dev.projectflow.web.error.ApiErrorBody;
import dev.projectflow.web.error.ApiException;
import dev.projectflow.web.error.ErrorCode;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Sign-in, registration, the signed-in user's account, dashboard and calendar. */
@RestController
@RequestMapping("/api")
public class AccountController {

    private final AuthService auth;
    private final InsightService insights;
    private final SearchService searchService;
    private final CatchUpService catchUp;
    private final AccountService accounts;
    private final SessionCookie cookies;
    private final int trustedProxies;

    public AccountController(AuthService auth, InsightService insights, SearchService searchService, CatchUpService catchUp, AppProperties props,
                             AccountService accounts, SessionCookie cookies) {
        this.accounts = accounts;
        this.cookies = cookies;
        this.searchService = searchService;
        this.catchUp = catchUp;
        this.auth = auth;
        this.insights = insights;
        this.trustedProxies = props.botProtection() == null ? 1 : props.botProtection().proxies();
    }

    private ClientInfo client(HttpServletRequest request) {
        return ClientInfo.of(request, trustedProxies);
    }

    /**
     * Sets the "keep me signed in" cookie for a kept sign-in, or removes any earlier one for a sign-in
     * that isn't kept. The cookie's value goes only in Set-Cookie, never in the response body.
     */
    private Dto.AuthResponse signedIn(AuthService.SignIn s, HttpServletRequest request, HttpServletResponse response) {
        if (s.response().token() != null) {
            response.addHeader(HttpHeaders.SET_COOKIE, s.cookie() != null ? cookies.keep(request, s.cookie(), s.expires()) : cookies.forget(request));
        }
        return s.response();
    }

    /** What the sign-in pages should offer: sign-up open, emails, confirmation, bot check. */
    @GetMapping("/auth/options")
    public ApiResponse<Dto.AuthOptions> options() {
        return ApiResponse.ok(auth.options());
    }

    @PostMapping("/auth/login")
    public ApiResponse<Dto.AuthResponse> login(@Valid @RequestBody Requests.Login req, HttpServletRequest request, HttpServletResponse response) {
        return ApiResponse.ok(signedIn(auth.login(req, client(request)), request, response), "Signed in.");
    }

    /**
     * "Keep me signed in": a new sign-in token from the HttpOnly cookie, for a tab opened later or a
     * token that expired. Only the app may ask (its Origin), and the cookie only ever renews its own
     * session. Without a usable cookie the answer is 401, and the cookie is removed.
     */
    @PostMapping("/auth/refresh")
    public ResponseEntity<?> refresh(HttpServletRequest request) {
        if (!cookies.fromTheApp(request)) throw ApiException.forbidden("A sign-in can only be renewed from the app itself.");
        java.util.Optional<String> cookie = cookies.read(request);
        java.util.Optional<Dto.AuthResponse> res = cookie.isEmpty() ? java.util.Optional.empty() : auth.refresh(cookie.get(), client(request));
        if (res.isPresent()) return ResponseEntity.ok(ApiResponse.ok(res.get()));
        ResponseEntity.BodyBuilder answer = ResponseEntity.status(HttpStatus.UNAUTHORIZED);
        if (cookie.isPresent()) answer.header(HttpHeaders.SET_COOKIE, cookies.forget(request));
        return answer.body(ApiErrorBody.of(401, ErrorCode.UNAUTHORIZED, "Unauthorized",
                "This browser isn’t kept signed in any more. Please sign in again.", null, request.getRequestURI()));
    }

    @PostMapping("/auth/register")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<Dto.AuthResponse> register(@Valid @RequestBody Requests.Register req, HttpServletRequest request, HttpServletResponse response) {
        Dto.AuthResponse res = signedIn(auth.register(req, client(request)), request, response);
        return ApiResponse.ok(res, res.verificationRequired() ? "Account created. Confirm your email to sign in." : "Account created.");
    }

    @PostMapping("/auth/verify-email")
    public ApiResponse<Dto.VerifiedEmail> verifyEmail(@Valid @RequestBody Requests.VerifyEmail req) {
        return ApiResponse.ok(auth.verifyEmail(req), "Email confirmed. You can sign in now.");
    }

    @PostMapping("/auth/resend-verification")
    public ApiResponse<Void> resendVerification(@Valid @RequestBody Requests.EmailLinkRequest req, HttpServletRequest request) {
        return ApiResponse.ok(null, auth.resendVerification(req, client(request)));
    }

    @PostMapping("/auth/forgot-password")
    public ApiResponse<Void> forgotPassword(@Valid @RequestBody Requests.EmailLinkRequest req, HttpServletRequest request) {
        return ApiResponse.ok(null, auth.forgotPassword(req, client(request)));
    }

    @PostMapping("/auth/reset-password")
    public ApiResponse<Void> resetPassword(@Valid @RequestBody Requests.ResetPassword req, HttpServletRequest request) {
        return ApiResponse.ok(null, auth.resetPassword(req, client(request)));
    }

    @GetMapping("/auth/me")
    public ApiResponse<Dto.User> me() {
        return ApiResponse.ok(auth.currentUser());
    }

    @PutMapping("/users/me")
    public ApiResponse<Dto.User> updateProfile(@Valid @RequestBody Requests.UpdateProfile req) {
        return ApiResponse.ok(auth.updateProfile(req), "Profile updated.");
    }

    /** Returns a new session for this device; every other device is signed out. */
    @PutMapping("/users/me/password")
    public ApiResponse<Dto.AuthResponse> changePassword(@Valid @RequestBody Requests.ChangePassword req, HttpServletRequest request,
                                                        HttpServletResponse response) {
        return ApiResponse.ok(signedIn(auth.changePassword(req, client(request)), request, response), "Password changed. Other devices were signed out.");
    }

    // ---------------------------------------------------------------- sessions

    /**
     * Signs this browser out on the server (its tab's session and its kept sign-in): those tokens
     * stop working wherever they were copied, and the "keep me signed in" cookie is removed. Without a
     * usable token, the cookie alone ends its own session, but only when the app asks.
     */
    @PostMapping("/auth/logout")
    public ApiResponse<Void> logout(HttpServletRequest request, HttpServletResponse response) {
        boolean signedIn = CurrentUser.orNull() != null;
        String cookie = cookies.read(request).filter(c -> signedIn || cookies.fromTheApp(request)).orElse(null);
        boolean ended = auth.logout(cookie);
        // Removed either way (kept on the error answer too): a cookie whose session has ended is no use.
        response.addHeader(HttpHeaders.SET_COOKIE, cookies.forget(request));
        if (!ended) throw ApiException.unauthorized("Your session has expired. Please sign in again.");
        return ApiResponse.ok(null, "Signed out.");
    }

    @PostMapping("/auth/logout-everywhere")
    public ApiResponse<Void> logoutEverywhere(HttpServletRequest request, HttpServletResponse response) {
        int ended = auth.logoutEverywhere();
        response.addHeader(HttpHeaders.SET_COOKIE, cookies.forget(request));
        return ApiResponse.ok(null, "Signed out of " + ended + (ended == 1 ? " session." : " sessions."));
    }

    @GetMapping("/auth/sessions")
    public ApiResponse<java.util.List<Dto.SessionInfo>> sessions() {
        return ApiResponse.ok(auth.mySessions());
    }

    @DeleteMapping("/auth/sessions/{sessionId}")
    public ApiResponse<Void> endSession(@PathVariable long sessionId) {
        auth.endSession(sessionId);
        return ApiResponse.ok(null, "That session was signed out.");
    }

    // ---------------------------------------------------------------- my data

    /** Everything Niveloft holds about me, as a JSON download. */
    @GetMapping(value = "/users/me/export", produces = "application/json")
    public org.springframework.http.ResponseEntity<java.util.Map<String, Object>> exportAccount() {
        return org.springframework.http.ResponseEntity.ok()
                .header(org.springframework.http.HttpHeaders.CONTENT_DISPOSITION,
                        org.springframework.http.ContentDisposition.attachment().filename("niveloft-account-" + LocalDate.now() + ".json").build().toString())
                .cacheControl(org.springframework.http.CacheControl.noStore())
                .body(accounts.export());
    }

    @GetMapping("/users/me/deletion-check")
    public ApiResponse<Dto.DeletionCheck> deletionCheck() {
        return ApiResponse.ok(accounts.deletionCheck());
    }

    /** Deletes my account (password and the word DELETE to confirm). */
    @PostMapping("/users/me/delete")
    public ApiResponse<Void> deleteAccount(@Valid @RequestBody Requests.DeleteAccount req) {
        accounts.delete(req);
        return ApiResponse.ok(null, "Your account was deleted.");
    }

    @GetMapping("/dashboard")
    public ApiResponse<Dto.Dashboard> dashboard() {
        return ApiResponse.ok(insights.dashboard(CurrentUser.id()));
    }

    /** What other people did in your projects since you last caught up on Today. */
    @GetMapping("/catch-up")
    public ApiResponse<Dto.CatchUp> catchUp() {
        return ApiResponse.ok(catchUp.forUser(CurrentUser.id()));
    }

    @PostMapping("/catch-up/seen")
    public ApiResponse<Void> caughtUp() {
        catchUp.markCaughtUp(CurrentUser.id());
        return ApiResponse.ok(null);
    }

    @GetMapping("/calendar")
    public ApiResponse<java.util.List<Dto.CalendarEvent>> calendar(
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
            @RequestParam(required = false) Long projectId,
            @RequestParam(defaultValue = "false") boolean mine) {
        return ApiResponse.ok(insights.calendar(CurrentUser.id(), from, to, projectId, mine));
    }

    /** Quick search across the caller's projects and tasks (command palette). */
    @GetMapping("/search")
    public ApiResponse<Dto.SearchResult> search(@RequestParam(defaultValue = "") String q, @RequestParam(defaultValue = "8") int limit) {
        return ApiResponse.ok(searchService.search(CurrentUser.id(), q, limit));
    }
}
