package dev.projectflow.security;

import dev.projectflow.config.AppProperties;
import dev.projectflow.config.LaunchProperties;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;
import javax.crypto.SecretKey;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Issues and verifies HMAC-signed sign-in tokens (HS384 for the recommended 48-byte key; jjwt picks
 * HS256, HS384 or HS512 by key length). The key comes from {@code JWT_SECRET}. A token
 * names its issuer and audience (both checked), the account, and the server-side session it
 * belongs to ("sid"); it expires when its session would, and the session itself is checked on
 * every request.
 *
 * <p>Rotating the key: set the new key as JWT_SECRET and the old one as JWT_PREVIOUS_SECRET. New
 * tokens are signed with the new key; tokens signed with the old one keep working until they
 * expire, at most JWT_EXPIRATION_SECONDS (a day) later. Kept sign-ins get new tokens from their
 * cookie, signed with the new key. So remove JWT_PREVIOUS_SECRET a day later, or at once, with
 * "sign everyone out", if the old key leaked.
 */
@Service
public class JwtService {

    static final String ISSUER = "niveloft";
    static final String AUDIENCE = "niveloft-api";

    private final SecretKey key;
    private final SecretKey previousKey;
    private final long expirationSeconds;

    /** The development default in application.yml. It is public, so it must never sign real sessions. */
    static final String DEVELOPMENT_SECRET = "ZGV2LW9ubHktcHJvamVjdGZsb3ctc2VjcmV0LWNoYW5nZS1tZS1iZWZvcmUtZGVwbG95aW5nLTEyMzQ1Ng==";

    public JwtService(AppProperties props, LaunchProperties launch, @Value("${spring.datasource.url:}") String datasourceUrl) {
        if (DEVELOPMENT_SECRET.equals(props.jwt().secret()) && !isLocalDatabase(datasourceUrl)) {
            throw new IllegalStateException(
                    "JWT_SECRET is not set. The built-in development key is public, so anyone could forge sign-ins. "
                            + "Set JWT_SECRET to the output of: openssl rand -base64 48");
        }
        this.key = keyFrom(props.jwt().secret(), "JWT_SECRET");
        String previous = launch == null ? null : launch.sessionsOrDefault().previousJwtSecret();
        this.previousKey = previous == null || previous.isBlank() ? null : keyFrom(previous.trim(), "JWT_PREVIOUS_SECRET");
        this.expirationSeconds = props.jwt().expirationSeconds();
    }

    private static SecretKey keyFrom(String base64, String name) {
        byte[] bytes;
        try {
            bytes = Decoders.BASE64.decode(base64);
        } catch (RuntimeException e) {
            throw new IllegalStateException(name + " must be a base64 value (openssl rand -base64 48)");
        }
        if (bytes.length < 32) throw new IllegalStateException(name + " must be a base64 value of at least 32 bytes (openssl rand -base64 48)");
        return Keys.hmacShaKeyFor(bytes);
    }

    /** A database on this machine (or an in-memory one): local development, where the default key is allowed. */
    static boolean isLocalDatabase(String url) {
        if (url == null || url.isBlank()) return true;
        String u = url.toLowerCase();
        return u.startsWith("jdbc:h2:") || u.contains("//localhost") || u.contains("//127.0.0.1") || u.contains("//[::1]") || u.contains("//host.docker.internal");
    }

    /** The longest a token may live (JWT_EXPIRATION_SECONDS); its session usually ends it sooner. */
    public long expirationSeconds() {
        return expirationSeconds;
    }

    /** A token for a session, valid until the session's own limit (or JWT_EXPIRATION_SECONDS, if sooner). */
    public String issue(Long userId, String email, String sessionId, Instant sessionExpires) {
        Instant now = Instant.now();
        Instant cap = now.plusSeconds(expirationSeconds);
        Instant expires = sessionExpires == null || sessionExpires.isAfter(cap) ? cap : sessionExpires;
        return Jwts.builder()
                .issuer(ISSUER)
                .audience().add(AUDIENCE).and()
                .subject(String.valueOf(userId))
                .claim("email", email)
                .claim("sid", sessionId)
                .issuedAt(Date.from(now))
                .expiration(Date.from(expires))
                .signWith(key)
                .compact();
    }

    /** The account and session in a valid, unexpired token from this issuer for this audience; empty for anything else. */
    public Optional<AuthUser> verify(String token) {
        Optional<AuthUser> user = verifyWith(key, token);
        if (user.isEmpty() && previousKey != null) user = verifyWith(previousKey, token);
        return user;
    }

    private static Optional<AuthUser> verifyWith(SecretKey k, String token) {
        try {
            Claims claims = Jwts.parser().verifyWith(k).requireIssuer(ISSUER).requireAudience(AUDIENCE).build().parseSignedClaims(token).getPayload();
            String sid = claims.get("sid", String.class);
            if (sid == null || sid.isBlank()) return Optional.empty(); // tokens from before sessions existed: sign in again
            return Optional.of(new AuthUser(Long.valueOf(claims.getSubject()), claims.get("email", String.class), sid));
        } catch (JwtException | IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}
