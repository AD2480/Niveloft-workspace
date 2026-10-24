/** Bounds the whole request, including reading its body, even if a fetch never settles. */
export async function withRequestDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  milliseconds: number,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    const stop = (reason: unknown) => {
      controller.abort(reason);
      reject(reason);
    };
    onAbort = () => stop(parent?.reason ?? new DOMException('Request cancelled', 'AbortError'));
    if (parent?.aborted) onAbort();
    else {
      parent?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => stop(new DOMException('The server took too long to respond', 'TimeoutError')), milliseconds);
    }
  });
  try {
    if (controller.signal.aborted) return await interrupted;
    return await Promise.race([request(controller.signal), interrupted]);
  } finally {
    clearTimeout(timer);
    if (onAbort) parent?.removeEventListener('abort', onAbort);
  }
}
