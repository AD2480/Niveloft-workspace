package dev.projectflow.security;

import dev.projectflow.web.error.ApiException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/** Static access to the signed-in user for the current request. */
public final class CurrentUser {

    private CurrentUser() {}

    public static AuthUser get() {
        AuthUser user = orNull();
        if (user == null) throw ApiException.unauthorized("Your session has expired. Please sign in again.");
        return user;
    }

    /** The signed-in user, or null when the request has no usable sign-in (on the few public endpoints). */
    public static AuthUser orNull() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.getPrincipal() instanceof AuthUser user ? user : null;
    }

    public static Long id() {
        return get().id();
    }

    /** The current request's session ("sid" of its token). */
    public static String sessionId() {
        return get().sessionId();
    }
}
