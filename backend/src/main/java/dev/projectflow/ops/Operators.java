package dev.projectflow.ops;

import dev.projectflow.config.OperatorProperties;
import dev.projectflow.security.CurrentUser;
import dev.projectflow.web.error.ApiException;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/** Who runs this site (OPERATOR_EMAILS). Only they may see Site health and contact messages. */
@Component
public class Operators {

    private final Set<String> emails;

    public Operators(OperatorProperties props) {
        String raw = props == null || props.emails() == null ? "" : props.emails();
        this.emails = Arrays.stream(raw.split("[,;\\s]+"))
                .map(e -> e.trim().toLowerCase(Locale.ROOT))
                .filter(e -> e.contains("@"))
                .collect(Collectors.toUnmodifiableSet());
    }

    public boolean isOperator(String email) {
        return email != null && emails.contains(email.trim().toLowerCase(Locale.ROOT));
    }

    public boolean configured() {
        return !emails.isEmpty();
    }

    /** The signed-in person must be an operator (403 otherwise, without saying who is). */
    public void require() {
        if (!isOperator(CurrentUser.get().email())) {
            throw ApiException.forbidden("Only the people who run this site can do this.");
        }
    }
}
