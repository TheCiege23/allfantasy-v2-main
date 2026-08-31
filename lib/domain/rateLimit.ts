/**
 * Commissioner OS · per-tenant rate limiting. T-114.
 *
 * "`Tenant.apiRateLimit` enforced centrally. A plan change must not need a
 * deploy."
 *
 * ─── THE LIMIT COMES FROM THE ROW, NEVER FROM A CONSTANT ─────────────────────
 * That sentence is the whole ticket. `PLAN_LIMITS` in provisioning.ts COPIES
 * `apiRateLimit` onto the Tenant row at creation; from then on the row is
 * authoritative. Reading `PLAN_LIMITS[tenant.planKey]` here instead would look
 * equivalent and would break two things at once: a negotiated exception ("they
 * get 600") could not exist, and changing anyone's limit would mean editing a
 * constant and shipping it — which is precisely the deploy the ticket forbids.
 *
 * ─── ⚠ A SLIDING WINDOW, BECAUSE A FIXED ONE PERMITS DOUBLE THE LIMIT ───────
 * The obvious implementation counts requests in the current minute and resets
 * on the boundary. With a limit of 60, a caller sends 60 at 11:59:59 and 60 more
 * at 12:00:00 — 120 requests in one second, entirely within the rules. Every
 * limit is really two limits, and the burst lands exactly when a cron-driven
 * client is most likely to fire.
 *
 * This weights the previous window by how much of it is still in view, so the
 * boundary is smooth. It costs one extra counter per tenant and no extra reads.
 */

import { type DomainError, rateLimited } from './errors'
import { type Result, err, ok } from './result'

export const DEFAULT_WINDOW_MS = 60_000

export type RateLimitWindow = {
  /** Window start, in whole windows since the epoch. */
  readonly window: number
  readonly count: number
  readonly previousCount: number
}

/**
 * Where counters live.
 *
 * 🛑 THIS IS A PORT BECAUSE THE OBVIOUS IMPLEMENTATION IS WRONG ON THIS
 * PLATFORM. An in-process Map limits one Node instance. This app deploys to
 * Vercel serverless, where concurrent instances each hold their own Map — so a
 * limit of 60 becomes 60 × however many instances are warm, which is a number
 * nobody controls and nobody can observe. It does not fail; it silently stops
 * being a limit under exactly the load that made you want one.
 *
 * Production needs a SHARED store. This repo already has Postgres, so an
 * atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` on a counters table is
 * the cheapest correct option and needs no new infrastructure.
 */
export type RateLimitStore = {
  /**
   * Atomically increment and return the resulting state.
   *
   * ⚠ ATOMIC IS LOAD-BEARING. A read-then-write store lets two concurrent
   * requests both read 59, both write 60, and both be allowed — the limit leaks
   * by exactly the concurrency, which is worst when it matters most.
   */
  increment(key: string, window: number, windowMs: number): Promise<RateLimitWindow>
}

export type RateLimitDecision = {
  readonly allowed: boolean
  readonly limit: number
  readonly remaining: number
  /** Seconds until the window rolls. Becomes `Retry-After`. */
  readonly retryAfterSeconds: number
  /** Unix seconds at which the current window ends. */
  readonly resetAt: number
  /** Weighted count actually used for the decision — exposed for diagnosis. */
  readonly observed: number
}

/**
 * The sliding-window decision, as a pure function.
 *
 * Split from the store so the arithmetic — which is the part that is subtly
 * wrong in most implementations — is testable without any I/O.
 */
export function decide(
  state: RateLimitWindow,
  limit: number,
  nowMs: number,
  windowMs: number = DEFAULT_WINDOW_MS,
): RateLimitDecision {
  const windowStart = state.window * windowMs
  const elapsed = nowMs - windowStart
  // How much of the PREVIOUS window is still inside the trailing view.
  const previousWeight = Math.max(0, 1 - elapsed / windowMs)
  const observed = state.previousCount * previousWeight + state.count

  const resetAtMs = windowStart + windowMs
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAtMs - nowMs) / 1000))

  return {
    // `>` not `>=`: a limit of 60 must ALLOW the 60th request. Off by one here
    // sells every plan one request short of what its page advertises.
    allowed: observed <= limit,
    limit,
    remaining: Math.max(0, Math.floor(limit - observed)),
    retryAfterSeconds,
    resetAt: Math.ceil(resetAtMs / 1000),
    observed,
  }
}

export function windowFor(nowMs: number, windowMs: number = DEFAULT_WINDOW_MS): number {
  return Math.floor(nowMs / windowMs)
}

/** Key shape. Tenant-scoped so one operator's traffic cannot exhaust another's. */
export function rateLimitKey(tenantId: string, bucket = 'api'): string {
  return `ratelimit:${bucket}:${tenantId}`
}

export type RateLimiterDeps = {
  readonly store: RateLimitStore
  readonly now?: () => number
  readonly windowMs?: number
}

/**
 * Check one request against a tenant's own limit.
 *
 * `limit` is passed in by the caller, resolved from the Tenant row — this
 * module deliberately does no lookup of its own, so there is exactly one place
 * that decides where the number comes from and it is not buried here.
 */
export function createRateLimiter(deps: RateLimiterDeps) {
  const now = deps.now ?? Date.now
  const windowMs = deps.windowMs ?? DEFAULT_WINDOW_MS

  return async function checkRateLimit(
    tenantId: string,
    limit: number,
    bucket = 'api',
  ): Promise<Result<RateLimitDecision, DomainError>> {
    // A non-positive or nonsense limit means the tenant row is wrong. FAIL
    // CLOSED: a limiter that treats a bad configuration as "unlimited" removes
    // the control at exactly the moment someone has fat-fingered it, and the
    // symptom is no symptom at all.
    if (!Number.isFinite(limit) || limit <= 0) {
      return err(rateLimited(0, Math.ceil(windowMs / 1000), Math.ceil(windowMs / 1000)))
    }

    const nowMs = now()
    const state = await deps.store.increment(rateLimitKey(tenantId, bucket), windowFor(nowMs, windowMs), windowMs)
    const decision = decide(state, limit, nowMs, windowMs)

    if (!decision.allowed) {
      return err(rateLimited(limit, decision.retryAfterSeconds, Math.ceil(windowMs / 1000)))
    }
    return ok(decision)
  }
}

/**
 * Headers to set on every response, allowed or refused.
 *
 * ⚠ ON SUCCESSES TOO, NOT ONLY ON 429s. A client that only learns its budget by
 * exceeding it has no way to slow down before it does — so the well-behaved
 * integration and the runaway one behave identically, and only the runaway one
 * ever finds out.
 */
export function rateLimitHeaders(d: RateLimitDecision): Record<string, string> {
  const headers: Record<string, string> = {
    'x-ratelimit-limit': String(d.limit),
    'x-ratelimit-remaining': String(d.remaining),
    'x-ratelimit-reset': String(d.resetAt),
  }
  // Retry-After only when refused. Sending it on a success invites clients to
  // wait when they need not.
  if (!d.allowed) headers['retry-after'] = String(d.retryAfterSeconds)
  return headers
}

/**
 * An in-memory store.
 *
 * 🛑 FOR TESTS AND SINGLE-PROCESS DEVELOPMENT ONLY. See `RateLimitStore` — on
 * serverless this limits each instance separately, which is not a limit. It is
 * exported so the algorithm can be exercised, and named so nobody wires it into
 * a request path by mistake.
 */
export function createInMemoryRateLimitStore(): RateLimitStore & { size: () => number } {
  const buckets = new Map<string, { window: number; count: number; previousCount: number }>()

  return {
    size: () => buckets.size,
    async increment(key, window) {
      const existing = buckets.get(key)

      if (!existing) {
        buckets.set(key, { window, count: 1, previousCount: 0 })
        return { window, count: 1, previousCount: 0 }
      }

      if (existing.window === window) {
        existing.count += 1
        return { ...existing }
      }

      // Rolled forward. One window back keeps its count as the trailing weight;
      // anything older is dropped, because a gap of two windows means the
      // previous window is entirely out of view and carrying it would refuse
      // requests on the strength of traffic from minutes ago.
      const previousCount = existing.window === window - 1 ? existing.count : 0
      const next = { window, count: 1, previousCount }
      buckets.set(key, next)
      return { ...next }
    },
  }
}
