package dev.projectflow.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class ClientInfoTest {

    @Test
    void trustsOnlyTheHopsAddedByKnownProxies() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRemoteAddr("10.0.0.2");
        req.addHeader("X-Forwarded-For", "6.6.6.6, 203.0.113.9");
        assertThat(ClientInfo.of(req, 1).ip()).isEqualTo("203.0.113.9"); // 6.6.6.6 was typed by the client
        assertThat(ClientInfo.of(req, 0).ip()).isEqualTo("10.0.0.2");
    }

    @Test
    void describesTheDeviceWithoutTheRawHeader() {
        assertThat(ClientInfo.device("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"))
                .isEqualTo("Chrome on macOS");
        assertThat(ClientInfo.device(null)).isEqualTo("an unknown device");
    }
}
