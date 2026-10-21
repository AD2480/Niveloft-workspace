package dev.projectflow.security;

import dev.projectflow.config.AppProperties;
import dev.projectflow.config.LaunchProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/**
 * The "keep me signed in" cookie. Sign-in tokens live only in the tab (sessionStorage), where they
 * end with it; a kept sign-in is remembered by this cookie instead, which page scripts can't read
 * (HttpOnly). It's sent only to {@code /api/auth} (Path), only over HTTPS in production (Secure,
 * with the {@code __Secure-} name), and all it can do is get a new sign-in token for its own
 * session, through {@code POST /api/auth/refresh}, while that session is active. Signing out,
 * signing out everywhere, a password change or reset, suspension and deletion end the session, and
 * so the cookie.
 *
 * <p>SameSite ({@code SESSION_COOKIE_SAMESITE}, see {@link LaunchProperties.Sessions#sameSite}):
 * by default None over HTTPS, because the app and the API usually sit on different sites (Vercel
 * and Railway, say); the cookie is then Partitioned, so browsers keep it for the app's site only.
 * Browsers that block cookies of other sites outright may drop it; the sign-in then lasts as long
 * as the tab, as if "keep me signed in" were unticked. Serving the API from the app's own site
 * (api.example.com beside app.example.com) avoids that.
 */
@Component
public class SessionCookie {

    static final String NAME = "niveloft-session";
    /** Over HTTPS: browsers only accept a {@code __Secure-} cookie that is Secure and came over HTTPS. */
    static final String SECURE_NAME = "__Secure-niveloft-session";
    static final String PATH = "/api/auth";

    private final LaunchProperties.Sessions policy;
    private final boolean httpsRequired;
    private final List<String> origins;
    private final Clock clock;

    public SessionCookie(AppProperties props, LaunchProperties launch, Clock clock) {
        this.policy = (launch == null ? LaunchProperties.defaults() : launch).sessionsOrDefault();
        this.httpsRequired = props.https() != null && props.https().required();
        this.origins = props.cors() == null || props.cors().allowedOrigins() == null ? List.of()
                : props.cors().allowedOrigins().stream().map(SessionCookie::origin).filter(o -> !o.isEmpty()).toList();
        this.clock = clock;
    }

    private boolean https(HttpServletRequest request) {
        return httpsRequired || ClientInfo.overHttps(request);
    }

    /** The Set-Cookie value that keeps this sign-in until {@code expires}. */
    public String keep(HttpServletRequest request, String value, Instant expires) {
        long seconds = Math.max(1, Duration.between(Instant.now(clock), expires).getSeconds());
        return build(request, value, Duration.ofSeconds(seconds));
    }

    /** The Set-Cookie value that removes the cookie (a sign-in that isn't kept, or signing out). */
    public String forget(HttpServletRequest request) {
        return build(request, "", Duration.ZERO);
    }

    private String build(HttpServletRequest request, String value, Duration maxAge) {
        boolean https = https(request);
        String sameSite = policy.sameSite(https);
        boolean none = "None".equals(sameSite);
        boolean secure = https || none; // SameSite=None is only accepted on a Secure cookie
        return ResponseCookie.from(secure ? SECURE_NAME : NAME, value)
                .httpOnly(true)
                .secure(secure)
                .path(PATH)
                .maxAge(maxAge)
                .sameSite(sameSite)
                .partitioned(none)
                .build()
                .toString();
    }

    /** The cookie's value on this request, if it came with one. */
    public Optional<String> read(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return Optional.empty();
        for (Cookie c : cookies) {
            if ((SECURE_NAME.equals(c.getName()) || NAME.equals(c.getName())) && c.getValue() != null && !c.getValue().isBlank()) {
                return Optional.of(c.getValue());
            }
        }
        return Optional.empty();
    }

    /**
     * Whether the request comes from the app: its Origin is one of CORS_ALLOWED_ORIGINS, or this
     * API's own address. Without an Origin header, only a browser's same-origin request
     * (Sec-Fetch-Site) counts. Refreshing only ever answers the app, never another site's page.
     */
    public boolean fromTheApp(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        if (origin == null || origin.isBlank()) return "same-origin".equalsIgnoreCase(request.getHeader("Sec-Fetch-Site"));
        String o = origin(origin);
        if (origins.contains(o)) return true;
        String host = request.getHeader("Host");
        return host != null && o.equals(origin((https(request) ? "https://" : "http://") + host));
    }

    /** An origin compared as browsers send it: lower case, without a trailing slash. */
    static String origin(String value) {
        String v = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        while (v.endsWith("/")) v = v.substring(0, v.length() - 1);
        return v;
    }
}
