package dev.projectflow.config;

import java.time.Clock;
import java.time.ZoneId;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * One clock for the whole application, in the configured business time zone.
 * "Today" and "overdue" are always computed with this clock; tests replace it.
 */
@Configuration
public class TimeConfig {

    @Bean
    public Clock clock(AppProperties props) {
        return Clock.system(ZoneId.of(props.zone() == null ? "UTC" : props.zone()));
    }
}
