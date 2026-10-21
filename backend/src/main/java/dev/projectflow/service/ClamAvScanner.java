package dev.projectflow.service;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * Scans a file with a ClamAV daemon (clamd) over its INSTREAM command: the bytes are sent in chunks
 * and clamd answers "stream: OK" or "stream: &lt;signature&gt; FOUND". Used when UPLOAD_SCAN=clamav;
 * an upload is stored only after a clean answer.
 */
final class ClamAvScanner {

    private ClamAvScanner() {}

    enum Verdict { CLEAN, INFECTED, ERROR }

    record Result(Verdict verdict, String detail) {}

    static Result scan(String host, int port, Duration timeout, InputStream in) {
        int ms = (int) Math.min(Integer.MAX_VALUE, timeout.toMillis());
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), ms);
            socket.setSoTimeout(ms);
            OutputStream out = socket.getOutputStream();
            out.write("zINSTREAM\0".getBytes(StandardCharsets.US_ASCII));
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(ByteBuffer.allocate(4).putInt(n).array());
                out.write(buf, 0, n);
            }
            out.write(new byte[] {0, 0, 0, 0});
            out.flush();
            String reply = new String(socket.getInputStream().readAllBytes(), StandardCharsets.US_ASCII).replace("\0", "").trim();
            return interpret(reply);
        } catch (IOException e) {
            return new Result(Verdict.ERROR, e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    static Result interpret(String reply) {
        if (reply.endsWith(" OK") || reply.equals("OK")) return new Result(Verdict.CLEAN, null);
        if (reply.endsWith(" FOUND")) {
            String sig = reply.startsWith("stream: ") ? reply.substring(8, reply.length() - 6).trim() : reply.substring(0, reply.length() - 6).trim();
            return new Result(Verdict.INFECTED, sig);
        }
        return new Result(Verdict.ERROR, reply.isEmpty() ? "no answer" : reply);
    }
}
