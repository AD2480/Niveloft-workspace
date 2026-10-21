package dev.projectflow.security;

import dev.projectflow.config.AppProperties;
import jakarta.servlet.DispatcherType;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Stateless JWT security. Only sign-in, registration, renewing a kept sign-in (its own cookie),
 * health and API docs are public.
 * Project-level authorisation (Owner/Manager/Member/Viewer) is enforced by
 * {@code @PreAuthorize("@projectAccess...")} on controllers and again inside services.
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http, JwtAuthenticationFilter jwtFilter, JsonSecurityHandlers handlers) throws Exception {
        http.csrf(AbstractHttpConfigurer::disable)
                .cors(cors -> {})
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // The second, internal dispatch that finishes a streamed reply (Flurry's answers):
                        // the request was authorised when it arrived, and nothing new is read.
                        .dispatcherTypeMatchers(DispatcherType.ASYNC).permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/login", "/api/auth/register", "/api/auth/verify-email",
                                "/api/auth/resend-verification", "/api/auth/forgot-password", "/api/auth/reset-password").permitAll()
                        // "Keep me signed in": authenticated by its HttpOnly cookie, checked in the controller
                        // (signing out works with that cookie alone too, once the tab's token has expired).
                        .requestMatchers(HttpMethod.POST, "/api/auth/refresh", "/api/auth/logout").permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/auth/options").permitAll()
                        // Browsers report crashes even before sign-in (rate-limited per address).
                        .requestMatchers(HttpMethod.POST, "/api/client-errors", "/api/contact", "/api/metrics/forms").permitAll()
                        // Health for uptime monitors and the host (liveness and readiness too).
                        .requestMatchers("/actuator/health", "/actuator/health/**", "/swagger-ui.html", "/swagger-ui/**", "/v3/api-docs/**").permitAll()
                        // The SSE stream authenticates with a one-time ticket (EventSource can't send headers).
                        .requestMatchers(HttpMethod.GET, "/api/events/stream").permitAll()
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .anyRequest().authenticated())
                .exceptionHandling(e -> e.authenticationEntryPoint(handlers.entryPoint()).accessDeniedHandler(handlers.accessDenied()))
                .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource(AppProperties props) {
        CorsConfiguration config = new CorsConfiguration();
        List<String> origins = props.cors() == null || props.cors().allowedOrigins() == null ? List.of() : props.cors().allowedOrigins();
        config.setAllowedOrigins(origins);
        // The app's sign-in requests carry the "keep me signed in" cookie (credentials), which browsers
        // only allow for listed origins, never with "*" (production refuses "*" anyway).
        config.setAllowCredentials(origins.stream().noneMatch(o -> o.trim().equals("*")));
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "Accept", "Idempotency-Key", "X-Request-Id"));
        config.setExposedHeaders(List.of("Content-Disposition", "X-Request-Id", "Retry-After", "Idempotent-Replayed"));
        config.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        // The sign-in page checks this when the frontend is hosted on another origin.
        source.registerCorsConfiguration("/actuator/health", config);
        return source;
    }
}
