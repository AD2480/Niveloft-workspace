package dev.projectflow.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The people who run this copy of Niveloft: the email addresses (comma-separated, from
 * OPERATOR_EMAILS) whose accounts may open the Site health page. Nobody, when it isn't set.
 */
@ConfigurationProperties(prefix = "projectflow.operators")
public record OperatorProperties(String emails) {}
