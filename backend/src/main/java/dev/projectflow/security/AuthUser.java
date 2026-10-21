package dev.projectflow.security;

/**
 * The authenticated principal: the account in a valid sign-in token, and the server-side session
 * the token belongs to ({@code sessionId}, the token's "sid"). The session must still be active
 * (see {@link JwtAuthenticationFilter}); signing out ends it.
 */
public record AuthUser(Long id, String email, String sessionId) {
    public AuthUser(Long id, String email) {
        this(id, email, null);
    }
}
