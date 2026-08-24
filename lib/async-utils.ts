export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Small, polite jitter for API friendliness.
 * 250–500ms default.
 */
export function jitterSleep(minMs = 250, maxMs = 500) {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
  return sleep(ms);
}

/**
 * Races `work` against a timeout instead of letting one slow call hold up an entire batch.
 * `work` itself is never cancelled -- there is no AbortSignal here -- so on timeout the original
 * promise keeps running to completion (or failure) in the background; this only stops the caller
 * from waiting on it.
 */
export type TimeoutResult<T> = { ok: true; value: T } | { ok: false; timedOut: true };

export async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<TimeoutResult<T>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<TimeoutResult<T>>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, timedOut: true }), timeoutMs);
    });
    return await Promise.race([work.then((value) => ({ ok: true as const, value })), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Concurrency-limited runner (no deps).
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }

  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => runner()));
  return results;
}
