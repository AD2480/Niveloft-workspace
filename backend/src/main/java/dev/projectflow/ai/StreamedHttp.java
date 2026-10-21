package dev.projectflow.ai;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;

/**
 * Sends a request whose reply streams in (server-sent events or JSON lines) and hands each line to
 * a reader as it arrives. The lines are pushed on the HTTP client's own threads while the caller
 * waits in short steps, so it can stop at once: when the person stops the question, the provider's
 * stream is cancelled, which closes the connection, and the provider stops generating. Bounded by
 * an idle limit (nothing arrives for a while, the first line included) and a total limit.
 */
final class StreamedHttp {

    private StreamedHttp() {}

    /** Reads one line of the reply; an exception stops the stream and fails the request with it. */
    interface Reader {
        void line(String line) throws Exception;
    }

    /** The HTTP status, and the start of the body when it wasn't 2xx (for telling a refusal of tools apart). */
    record Result(int status, String errorBody) {
        boolean ok() {
            return status / 100 == 2;
        }
    }

    /** How often the caller looks at the stop flag and the limits. */
    static final long POLL_MS = 100;

    private static final int ERROR_BODY_MAX = 4000;

    static Result send(HttpClient http, HttpRequest request, Reader reader, BooleanSupplier stopped, Duration idle, Duration total) {
        if (stopped.getAsBoolean()) throw new ToolChat.Stopped();
        AtomicReference<Flow.Subscription> subscription = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        AtomicLong lastData = new AtomicLong(System.nanoTime());
        AtomicInteger status = new AtomicInteger();
        AtomicReference<String> errorBody = new AtomicReference<>("");
        CompletableFuture<Void> finished = new CompletableFuture<>();

        HttpResponse.BodyHandler<Void> handler = info -> {
            status.set(info.statusCode());
            lastData.set(System.nanoTime());
            if (info.statusCode() / 100 != 2) {
                return HttpResponse.BodySubscribers.mapping(HttpResponse.BodySubscribers.ofString(StandardCharsets.UTF_8), body -> {
                    errorBody.set(body == null ? "" : body.length() > ERROR_BODY_MAX ? body.substring(0, ERROR_BODY_MAX) : body);
                    return null;
                });
            }
            return HttpResponse.BodySubscribers.fromLineSubscriber(new Flow.Subscriber<String>() {
                @Override
                public void onSubscribe(Flow.Subscription s) {
                    subscription.set(s);
                    s.request(Long.MAX_VALUE);
                }

                @Override
                public void onNext(String line) {
                    lastData.set(System.nanoTime());
                    if (finished.isDone()) return;
                    try {
                        reader.line(line);
                    } catch (Throwable t) {
                        failure.compareAndSet(null, t);
                        Flow.Subscription s = subscription.get();
                        if (s != null) s.cancel();
                        finished.complete(null);
                    }
                }

                @Override
                public void onError(Throwable t) {
                    failure.compareAndSet(null, t);
                    finished.complete(null);
                }

                @Override
                public void onComplete() {
                    finished.complete(null);
                }
            });
        };

        CompletableFuture<HttpResponse<Void>> response = http.sendAsync(request, handler);
        long start = System.nanoTime();
        try {
            while (!finished.isDone() && !response.isDone()) {
                if (stopped.getAsBoolean()) {
                    abort(subscription, response, finished);
                    throw new ToolChat.Stopped();
                }
                long now = System.nanoTime();
                if (now - start > total.toNanos()) {
                    abort(subscription, response, finished);
                    throw new AiClient.AiClientException("AI provider took longer than " + total.toSeconds() + " s", null);
                }
                if (now - lastData.get() > idle.toNanos()) {
                    abort(subscription, response, finished);
                    throw new AiClient.AiClientException("AI provider sent nothing for " + idle.toSeconds() + " s", null);
                }
                try {
                    CompletableFuture.anyOf(finished, response).get(POLL_MS, TimeUnit.MILLISECONDS);
                } catch (TimeoutException | ExecutionException | CancellationException ignored) {
                    // look at the flag and the limits again
                }
            }
        } catch (InterruptedException e) {
            abort(subscription, response, finished);
            Thread.currentThread().interrupt();
            throw new AiClient.AiClientException("AI request was interrupted", e);
        }
        // A stop that came while the last line was read still counts as a stop.
        if (stopped.getAsBoolean()) {
            abort(subscription, response, finished);
            throw new ToolChat.Stopped();
        }
        Throwable f = failure.get();
        if (f == null && response.isCompletedExceptionally()) {
            try {
                response.join();
            } catch (CompletionException | CancellationException e) {
                f = e.getCause() != null ? e.getCause() : e;
            }
        }
        if (f != null) {
            if (f instanceof AiClient.AiClientException a) throw a;
            if (f instanceof HttpTimeoutException) throw new AiClient.AiClientException("AI provider didn’t respond in time", f);
            throw new AiClient.AiClientException("AI request failed: " + f.getClass().getSimpleName(), f);
        }
        return new Result(status.get(), errorBody.get());
    }

    private static void abort(AtomicReference<Flow.Subscription> subscription, CompletableFuture<?> response, CompletableFuture<Void> finished) {
        finished.complete(null);
        Flow.Subscription s = subscription.get();
        if (s != null) s.cancel();
        response.cancel(true);
    }
}
