// Ported from the plain-Java checks that ran in the sandbox for the launch release (the same
// assertions, now run by ./mvnw verify).
package dev.projectflow.service;

import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Set;

/** Upload allowlist and signatures, and the ClamAV client against a local stand-in clamd. */
class UploadRulesTest {
    static final List<String> results = new ArrayList<>();

    static void check(String name, boolean ok) {
        results.add((ok ? "PASS  " : "FAIL  ") + name);
    }

    @org.junit.jupiter.api.Test
    void allRules() throws Exception {
        results.clear();
        Set<String> allowed = Set.copyOf(dev.projectflow.config.LaunchProperties.Uploads.DEFAULT_EXTENSIONS);
        byte[] png = Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
        byte[] html = "<html><script>alert(1)</script></html>".getBytes(StandardCharsets.UTF_8);
        byte[] pdf = "%PDF-1.7\n%âãÏÓ\n".getBytes(StandardCharsets.ISO_8859_1);
        byte[] zip = {'P', 'K', 3, 4, 20, 0, 0, 0};
        byte[] jpeg = {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0, 16, 'J', 'F', 'I', 'F'};
        byte[] webp = {'R', 'I', 'F', 'F', 0, 0, 0, 0, 'W', 'E', 'B', 'P', 'V', 'P', '8', ' '};

        UploadCheck.Verdict v = UploadCheck.check("shot.png", png, allowed);
        check("a real PNG is accepted as image/png", v.ok() && "image/png".equals(v.contentType()));
        check("a page named .png is refused (contents don't match)", !UploadCheck.check("fake.png", html, allowed).ok());
        check("HTML isn't on the list", !UploadCheck.check("page.html", html, allowed).ok());
        check("HTM isn't either", !UploadCheck.check("page.htm", html, allowed).ok());
        check("executables aren't", !UploadCheck.check("tool.exe", new byte[] {'M', 'Z'}, allowed).ok());
        check("scripts aren't", !UploadCheck.check("run.sh", "#!/bin/sh".getBytes(), allowed).ok() && !UploadCheck.check("x.js", "1".getBytes(), allowed).ok());
        check("no extension is refused", !UploadCheck.check("README", "hello".getBytes(), allowed).ok());
        check("double extensions go by the last one", !UploadCheck.check("invoice.pdf.exe", new byte[] {'M', 'Z'}, allowed).ok());
        check("upper-case extensions are fine", UploadCheck.check("SCAN.PDF", pdf, allowed).ok());
        check("a PDF must start like one", UploadCheck.check("a.pdf", pdf, allowed).ok() && !UploadCheck.check("a.pdf", html, allowed).ok());
        check("Office files must be zip containers", UploadCheck.check("plan.docx", zip, allowed).ok() && !UploadCheck.check("plan.docx", html, allowed).ok());
        check("JPEG and WebP signatures", UploadCheck.check("p.jpg", jpeg, allowed).ok() && UploadCheck.check("p.webp", webp, allowed).ok()
                && !UploadCheck.check("p.webp", png, allowed).ok());
        UploadCheck.Verdict svg = UploadCheck.check("logo.svg", "<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>".getBytes(), allowed);
        check("SVG is accepted but stored as image/svg+xml, which is never shown inline", svg.ok() && "image/svg+xml".equals(svg.contentType())
                && !UploadCheck.INLINE_TYPES.contains(svg.contentType()));
        check("a truncated image is refused", !UploadCheck.check("tiny.png", new byte[] {(byte) 0x89, 'P'}, allowed).ok());
        check("an empty head is refused for signed types", !UploadCheck.check("x.gif", new byte[0], allowed).ok());
        check("text formats have no signature to check", UploadCheck.check("notes.md", "# Notes".getBytes(), allowed).ok()
                && "text/markdown".equals(UploadCheck.check("notes.md", "# Notes".getBytes(), allowed).contentType()));
        check("the operator's own list replaces the default", !UploadCheck.check("a.pdf", pdf, Set.of("png")).ok());
        check("every default extension has a stored type", allowed.stream().allMatch(UploadCheck.TYPES::containsKey));
        check("the refusal names the file and says what to do", UploadCheck.check("tool.exe", new byte[0], allowed).problem().contains("tool.exe")
                && UploadCheck.check("tool.exe", new byte[0], allowed).problem().contains("share a link"));

        // ClamAV INSTREAM against a stand-in daemon.
        try (ServerSocket server = new ServerSocket(0)) {
            Thread t = Thread.ofVirtual().start(() -> {
                while (!server.isClosed()) {
                    try (Socket s = server.accept()) {
                        DataInputStream in = new DataInputStream(s.getInputStream());
                        byte[] cmd = new byte[10];
                        in.readFully(cmd);
                        StringBuilder body = new StringBuilder();
                        boolean protocolOk = new String(cmd, StandardCharsets.US_ASCII).equals("zINSTREAM\0");
                        while (true) {
                            int n = in.readInt();
                            if (n == 0) break;
                            byte[] chunk = new byte[n];
                            in.readFully(chunk);
                            body.append(new String(chunk, StandardCharsets.ISO_8859_1));
                        }
                        OutputStream out = s.getOutputStream();
                        String reply = !protocolOk ? "UNKNOWN COMMAND" : body.toString().contains("EICAR") ? "stream: Eicar-Test-Signature FOUND" : "stream: OK";
                        out.write((reply + "\0").getBytes(StandardCharsets.US_ASCII));
                    } catch (Exception e) {
                        if (server.isClosed()) return;
                    }
                }
            });
            int port = server.getLocalPort();
            ClamAvScanner.Result clean = ClamAvScanner.scan("127.0.0.1", port, Duration.ofSeconds(3), new ByteArrayInputStream(png));
            check("clamd: a clean file scans OK", clean.verdict() == ClamAvScanner.Verdict.CLEAN);
            byte[] big = new byte[200_000];
            System.arraycopy("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR".getBytes(StandardCharsets.US_ASCII), 0, big, 150_000, 33);
            ClamAvScanner.Result bad = ClamAvScanner.scan("127.0.0.1", port, Duration.ofSeconds(3), new ByteArrayInputStream(big));
            check("clamd: a flagged file is INFECTED with its signature (sent in several chunks)", bad.verdict() == ClamAvScanner.Verdict.INFECTED
                    && "Eicar-Test-Signature".equals(bad.detail()));
            server.close();
            t.join(2000);
        }
        int closedPort;
        try (ServerSocket s = new ServerSocket(0)) {
            closedPort = s.getLocalPort();
        }
        ClamAvScanner.Result down = ClamAvScanner.scan("127.0.0.1", closedPort, Duration.ofSeconds(2), new ByteArrayInputStream(png));
        check("clamd unreachable is an ERROR (the upload is refused, not let through)", down.verdict() == ClamAvScanner.Verdict.ERROR);
        check("clamd replies are read strictly", ClamAvScanner.interpret("stream: OK").verdict() == ClamAvScanner.Verdict.CLEAN
                && ClamAvScanner.interpret("INSTREAM size limit exceeded. ERROR").verdict() == ClamAvScanner.Verdict.ERROR
                && ClamAvScanner.interpret("").verdict() == ClamAvScanner.Verdict.ERROR);
        org.assertj.core.api.Assertions.assertThat(results.stream().filter(r -> r.startsWith("FAIL")).toList()).as("failed checks").isEmpty();
    }
}
