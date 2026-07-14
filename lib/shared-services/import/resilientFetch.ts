/**
 * Generic resilient JSON fetch — Fantasy OS Migration Plan Milestone 2
 * (docs/os/ALLFANTASY_FANTASY_OS_MIGRATION_PLAN.md), first real piece of the
 * eventual Import Service (Milestone 1's service map).
 *
 * Deliberately provider-agnostic: Sleeper is the first consumer (see
 * lib/league-import/sleeper/SleeperLeagueFetchService.ts), but nothing here
 * is Sleeper-specific, so a future ESPN/Yahoo/MFL hardening pass has a real
 * shared utility to reuse instead of writing a 4th/5th ad-hoc retry loop.
 *
 * Distinguishes three outcomes explicitly, rather than collapsing everything
 * into `T | null` the way the code this replaces did:
 *   - success:  a 2xx response, parsed.
 *   - no_data:  a definitive "this doesn't exist" response (404, or another
 *               non-5xx 4xx) — legitimate absence of data, never retried,
 *               never reported as a warning.
 *   - failed:   every retry attempt was exhausted (network error, timeout,
 *               429, or 5xx) — this is a REAL failure, reported honestly
 *               instead of silently degrading to "no data".
 */

export interface ResilientFetchOptions {
  /** Total attempts including the first — default 3, matching prior (never-shipped) hardening design. */
  maxAttempts?: number
  /** Backoff delay before each retry, ms — index 0 is the delay before attempt 2, etc. */
  backoffMs?: number[]
  /** Hard per-attempt timeout via AbortController — default 12s. */
  timeoutMs?: number
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
  /** Injectable for tests; defaults to a real timer-based sleep. */
  sleepImpl?: (ms: number) => Promise<void>
}

export type ResilientFetchOutcome<T> =
  | { status: 'success'; data: T }
  | { status: 'no_data'; reason: string }
  | { status: 'failed'; reason: string; attempts: number }

const DEFAULT_BACKOFF_MS = [300, 600, 1200]
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_TIMEOUT_MS = 12_000

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/** 404 and other definitive 4xx responses mean "this doesn't exist" — never retried, never a warning. */
function isDefinitiveNoData(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429
}

/**
 * Fetch a JSON resource with retry/backoff/timeout, honestly distinguishing a
 * transient failure from a legitimate absence of data. Never throws — every
 * outcome, including exhaustion, is returned as a typed result.
 */
export async function fetchJsonWithRetry<T>(
  url: string,
  options: ResilientFetchOptions = {}
): Promise<ResilientFetchOutcome<T>> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleepImpl ?? defaultSleep

  let lastReason = 'unknown error'

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetchImpl(url, { signal: controller.signal })
      clearTimeout(timeout)

      if (res.ok) {
        const data = (await res.json()) as T
        return { status: 'success', data }
      }

      if (isDefinitiveNoData(res.status)) {
        return { status: 'no_data', reason: `HTTP ${res.status}` }
      }

      if (isRetryableStatus(res.status)) {
        lastReason = `HTTP ${res.status}`
        if (attempt < maxAttempts) {
          await sleep(backoffMs[Math.min(attempt - 1, backoffMs.length - 1)])
          continue
        }
        return { status: 'failed', reason: lastReason, attempts: attempt }
      }

      // Any other non-2xx status we don't have a specific rule for: treat as
      // no_data rather than silently retrying forever on something we can't fix.
      return { status: 'no_data', reason: `HTTP ${res.status}` }
    } catch (err) {
      clearTimeout(timeout)
      const errName = (err as { name?: unknown } | null)?.name
      lastReason =
        errName === 'AbortError'
          ? 'request timed out'
          : err instanceof Error
            ? err.message
            : 'network error'

      if (attempt < maxAttempts) {
        await sleep(backoffMs[Math.min(attempt - 1, backoffMs.length - 1)])
        continue
      }
      return { status: 'failed', reason: lastReason, attempts: attempt }
    }
  }

  // Unreachable in practice (the loop always returns), but keeps the return type total.
  return { status: 'failed', reason: lastReason, attempts: maxAttempts }
}
