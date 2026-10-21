package dev.projectflow.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Authenticates requests carrying {@code Authorization: Bearer <jwt>}. The token must be valid and
 * its session (the "sid" claim) must still be active: not signed out, not past its limit, not idle
 * too long, and belonging to the same account. Deleting an account deletes its sessions.
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    /** Set on the request when a token was valid but its session had ended, so the 401 can say why. */
    public static final String ENDED = "projectflow.sessionEnded";

    private final JwtService jwt;
    private final SessionStore sessions;

    public JwtAuthenticationFilter(JwtService jwt, SessionStore sessions) {
        this.jwt = jwt;
        this.sessions = sessions;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            jwt.verify(header.substring(7).trim()).ifPresent(user -> sessions.find(user.sessionId())
                    .filter(s -> s.userId() == user.id())
                    .ifPresent(s -> {
                        SessionStore.State state = sessions.state(s);
                        if (state != SessionStore.State.ACTIVE) {
                            request.setAttribute(ENDED, state);
                            return;
                        }
                        sessions.touch(s);
                        var auth = new UsernamePasswordAuthenticationToken(user, null, List.of(new SimpleGrantedAuthority("ROLE_USER")));
                        SecurityContextHolder.getContext().setAuthentication(auth);
                    }));
        }
        chain.doFilter(request, response);
    }
}
