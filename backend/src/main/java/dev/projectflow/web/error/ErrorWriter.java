package dev.projectflow.web.error;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

/** Writes the standard error envelope from filters, where the exception handler doesn't reach. */
@Component
public class ErrorWriter {

    private final ObjectMapper mapper;

    public ErrorWriter(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public void write(HttpServletResponse response, int status, ErrorCode code, String error, String message, String path) throws IOException {
        if (response.isCommitted()) return;
        response.resetBuffer();
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        mapper.writeValue(response.getOutputStream(), ApiErrorBody.of(status, code, error, message, null, path));
    }
}
