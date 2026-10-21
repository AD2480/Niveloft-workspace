package dev.projectflow;

import java.util.TimeZone;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class ProjectFlowApplication {

    public static void main(String[] args) {
        // Instants are stored as UTC everywhere (Hibernate's jdbc.time_zone, and JDBC timestamps
        // written directly), whatever the host's zone. Business dates use PROJECTFLOW_ZONE.
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));
        SpringApplication.run(ProjectFlowApplication.class, args);
    }
}
