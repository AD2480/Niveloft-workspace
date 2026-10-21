package dev.projectflow.security;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Who is calling, as far as the server can tell: the client's IP address and a short description
 * of the device (for sign-in alerts and rate limits).
 *
 * <p>Behind a hosting proxy the connection comes from the proxy, which appends the real client
 * address to {@code X-Forwarded-For}. Only the entries added by trusted proxies are believed, counted
 * from the right: anything further left was written by the client and could be made up.
 */
public record ClientInfo(String ip, String device) {

    public static ClientInfo of(HttpServletRequest request, int trustedProxies) {
        return new ClientInfo(ip(request, trustedProxies), device(request.getHeader("User-Agent")));
    }

    /** Whether the client reached us over HTTPS: hosting proxies end TLS and say so in X-Forwarded-Proto. */
    public static boolean overHttps(HttpServletRequest request) {
        String proto = request.getHeader("X-Forwarded-Proto");
        if (proto != null && !proto.isBlank()) return "https".equalsIgnoreCase(proto.split(",")[0].trim());
        return request.isSecure();
    }

    /**
     * The key rate limits use: the IP address, except that IPv6 addresses are cut to their /64
     * network, since one person usually controls a whole /64 and could otherwise rotate through it.
     */
    public String limitKey() {
        if (!ip.contains(":")) return ip;
        String[] parts = ip.split(":", -1);
        if (ip.contains("::") || parts.length < 4) {
            try {
                byte[] b = java.net.InetAddress.getByName(ip).getAddress();
                if (b.length == 16) {
                    StringBuilder sb = new StringBuilder();
                    for (int i = 0; i < 8; i += 2) sb.append(String.format("%02x%02x:", b[i], b[i + 1]));
                    return sb.append(":/64").toString();
                }
            } catch (java.net.UnknownHostException e) {
                return ip;
            }
        }
        return String.join(":", parts[0], parts[1], parts[2], parts[3]) + "::/64";
    }

    static String ip(HttpServletRequest request, int trustedProxies) {
        // Several X-Forwarded-For lines count as one list, in order.
        java.util.Enumeration<String> lines = request.getHeaders("X-Forwarded-For");
        String forwarded = lines == null || !lines.hasMoreElements() ? null : String.join(",", java.util.Collections.list(lines));
        if (trustedProxies > 0 && forwarded != null && !forwarded.isBlank()) {
            String[] hops = forwarded.split(",");
            int index = hops.length - trustedProxies;
            String candidate = hops[Math.max(0, index)].trim();
            if (!candidate.isEmpty() && candidate.length() <= 64) return candidate;
        }
        String remote = request.getRemoteAddr();
        return remote == null ? "unknown" : remote;
    }

    /** "Chrome on macOS", "Safari on iPhone"… from the User-Agent; never the raw header. */
    static String device(String ua) {
        if (ua == null || ua.isBlank()) return "an unknown device";
        String browser = ua.contains("Edg/") ? "Edge"
                : ua.contains("OPR/") || ua.contains("Opera") ? "Opera"
                : ua.contains("Firefox/") ? "Firefox"
                : ua.contains("Chrome/") || ua.contains("CriOS/") ? "Chrome"
                : ua.contains("Safari/") ? "Safari"
                : "a browser";
        String os = ua.contains("iPhone") ? "iPhone"
                : ua.contains("iPad") ? "iPad"
                : ua.contains("Android") ? "Android"
                : ua.contains("Mac OS X") || ua.contains("Macintosh") ? "macOS"
                : ua.contains("Windows") ? "Windows"
                : ua.contains("CrOS") ? "ChromeOS"
                : ua.contains("Linux") ? "Linux"
                : "an unknown system";
        return browser + " on " + os;
    }
}
