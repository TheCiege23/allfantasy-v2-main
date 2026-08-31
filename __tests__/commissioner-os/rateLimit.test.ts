/**
 * Commissioner OS · T-114.
 *
 * "`Tenant.apiRateLimit` enforced centrally. A plan change must not need a
 * deploy."
 *
 * The ticket states no acceptance tests, so these are derived from the two
 * claims it does make: the limit is per-tenant and comes from data, and it is
 * enforced in one place. Plus the arithmetic, which is where implementations of
 * this actually go wrong.
 */

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_WINDOW_MS,
  createInMemoryRateLimitStore,
  createRateLimiter,
  decide,
  rateLimitHeaders,
  rateLimitKey,
  windowFor,
} from '@/lib/domain/rateLimit'
import { PLAN_LIMITS } from '@/lib/domain/provisioning'
import { toHttpResponse } from '@/lib/domain/errors'

const T = 'tenant-a'
const OTHER = 'tenant-b'

/** A limiter whose clock the test drives. */
function limiterAt(startMs = 1_756_000_000_000) {
  let now = startMs
  const store = createInMemoryRateLimitStore()
  return {
    store,
    advance: (ms: number) => (now += ms),
    at: () => now,
    check: createRateLimiter({ store, now: () => now }),
  }
}

describe('T-114 · the limit comes from the row, not from a constant', () => {
  it('two tenants on the same plan can have different limits', () => {
    // 🛑 THE WHOLE TICKET. PLAN_LIMITS seeds apiRateLimit at provisioning; the
    // ROW is authoritative afterwards. Reading PLAN_LIMITS[planKey] here would
    // look equivalent and would make a negotiated exception impossible — and
    // changing anyone's limit would mean editing a constant and shipping it,
    // which is the deploy the ticket forbids.
    const l = limiterAt()
    return Promise.all([l.check(T, 2), l.check(OTHER, 100)]).then(([a, b]) => {
      expect(a.ok && a.value.limit).toBe(2)
      expect(b.ok && b.value.limit).toBe(100)
    })
  })

  it('nothing in the limiter imports a plan table', async () => {
    // The limiter takes `limit` as an argument. If it ever resolved the number
    // itself, there would be two places deciding where limits come from.
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const src = readFileSync(path.resolve(process.cwd(), 'lib/domain/rateLimit.ts'), 'utf8')
    const code = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n')
    expect(code).not.toContain('PLAN_LIMITS')
    expect(code).not.toContain('provisioning')
  })

  it('the plan table still seeds sane starting values (positive control)', () => {
    // If PLAN_LIMITS were empty this file's premise would be wrong and the test
    // above would pass for the wrong reason.
    for (const [key, limits] of Object.entries(PLAN_LIMITS)) {
      expect(limits.apiRateLimit, key).toBeGreaterThan(0)
    }
  })
})

describe('T-114 · per-tenant isolation', () => {
  it('one tenant exhausting its budget does not affect another', async () => {
    const l = limiterAt()
    for (let i = 0; i < 3; i++) await l.check(T, 3)
    expect((await l.check(T, 3)).ok).toBe(false)
    // OTHER is untouched — otherwise a single noisy operator is an outage for
    // everyone, which is the failure a per-tenant limit exists to prevent.
    expect((await l.check(OTHER, 3)).ok).toBe(true)
  })

  it('keys are namespaced by tenant and bucket', () => {
    expect(rateLimitKey(T)).not.toBe(rateLimitKey(OTHER))
    expect(rateLimitKey(T, 'webhooks')).not.toBe(rateLimitKey(T, 'api'))
    expect(rateLimitKey(T)).toContain(T)
  })

  it('separate buckets do not share a budget', async () => {
    const l = limiterAt()
    for (let i = 0; i < 2; i++) await l.check(T, 2, 'api')
    expect((await l.check(T, 2, 'api')).ok).toBe(false)
    expect((await l.check(T, 2, 'webhooks')).ok).toBe(true)
  })
})

describe('T-114 · the boundary arithmetic', () => {
  it('allows exactly the limit, then refuses', async () => {
    // `>` not `>=`. Off by one here sells every plan one request short of what
    // its pricing page says.
    const l = limiterAt()
    for (let i = 1; i <= 5; i++) {
      const r = await l.check(T, 5)
      expect(r.ok, `request ${i}`).toBe(true)
    }
    expect((await l.check(T, 5)).ok).toBe(false)
  })

  it('reports remaining accurately', async () => {
    const l = limiterAt()
    const first = await l.check(T, 10)
    expect(first.ok && first.value.remaining).toBe(9)
    const second = await l.check(T, 10)
    expect(second.ok && second.value.remaining).toBe(8)
  })

  it('🛑 a fixed window would permit DOUBLE the limit at the boundary — this does not', async () => {
    // The failure this design exists to prevent. With a naive reset-on-the-
    // minute counter, 5 requests at 59.999s and 5 more at 60.000s is 10 in one
    // millisecond and every rule is satisfied.
    const l = limiterAt(60_000) // exactly on a window boundary
    for (let i = 0; i < 5; i++) expect((await l.check(T, 5)).ok).toBe(true)

    l.advance(DEFAULT_WINDOW_MS) // roll into the next window
    // The previous window is still fully in view, so the weighted count starts
    // at ~5 and the very next request is refused rather than starting fresh.
    const r = await l.check(T, 5)
    expect(r.ok, 'a fixed window would have allowed this').toBe(false)
  })

  it('lets the previous window decay as it leaves view', async () => {
    const l = limiterAt(60_000)
    for (let i = 0; i < 5; i++) await l.check(T, 5)

    // Most of the way through the next window: only a fraction of the previous
    // count still counts, so there is budget again.
    l.advance(DEFAULT_WINDOW_MS + DEFAULT_WINDOW_MS * 0.9)
    expect((await l.check(T, 5)).ok).toBe(true)
  })

  it('drops a window that is entirely out of view', async () => {
    // A gap of two windows means the old count is fully behind the trailing
    // edge. Carrying it would refuse requests on the strength of traffic from
    // minutes ago.
    const l = limiterAt()
    for (let i = 0; i < 5; i++) await l.check(T, 5)
    l.advance(DEFAULT_WINDOW_MS * 3)
    const r = await l.check(T, 5)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.remaining).toBe(4)
  })

  it('windowFor buckets by whole windows', () => {
    expect(windowFor(0)).toBe(0)
    expect(windowFor(59_999)).toBe(0)
    expect(windowFor(60_000)).toBe(1)
  })

  it('decide never reports a negative remaining or a zero retry', () => {
    const d = decide({ window: 1, count: 500, previousCount: 500 }, 10, 60_000)
    expect(d.remaining).toBe(0)
    // Retry-After: 0 tells a client to retry immediately, which is a hot loop
    // against a service that just refused it.
    expect(d.retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })
})

describe('T-114 · it fails CLOSED on a bad limit', () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuses when the limit is %s', async (limit) => {
    // A limiter that treats a malformed configuration as "unlimited" removes
    // the control at exactly the moment someone has fat-fingered the row — and
    // the symptom is no symptom at all.
    const l = limiterAt()
    expect((await l.check(T, limit as number)).ok).toBe(false)
  })

  it('a valid limit still works (positive control)', async () => {
    const l = limiterAt()
    expect((await l.check(T, 1)).ok).toBe(true)
  })
})

describe('T-114 · the refusal is usable', () => {
  it('maps to 429 with Retry-After in the body', async () => {
    const l = limiterAt()
    await l.check(T, 1)
    const r = await l.check(T, 1)
    expect(r.ok).toBe(false)
    if (r.ok) return

    const res = toHttpResponse(r.error)
    expect(res.status).toBe(429)
    expect(res.body.error.retryable).toBe(true)
    expect(res.body.error.details).toMatchObject({ limit: 1 })
    expect((res.body.error.details as any).retryAfterSeconds).toBeGreaterThanOrEqual(1)
  })

  it('is RATE_LIMITED, not NOT_ENTITLED', () => {
    // Different sentences: NOT_ENTITLED is "your plan does not include this"
    // and the fix is to upgrade; RATE_LIMITED is "not this second" and the fix
    // is to wait. Collapsing them sends someone to a billing page over a burst,
    // and 402 is not a code any HTTP client retries.
    return limiterAt()
      .check(T, 0)
      .then((r) => {
        expect(r.ok).toBe(false)
        if (r.ok) return
        expect(r.error.code).toBe('RATE_LIMITED')
      })
  })

  it('🛑 emits headers on ALLOWED responses too', async () => {
    // A client that only learns its budget by exceeding it cannot slow down
    // before it does — so the well-behaved integration and the runaway one
    // behave identically, and only the runaway one ever finds out.
    const l = limiterAt()
    const r = await l.check(T, 10)
    if (!r.ok) throw new Error('expected allowed')
    const h = rateLimitHeaders(r.value)
    expect(h['x-ratelimit-limit']).toBe('10')
    expect(h['x-ratelimit-remaining']).toBe('9')
    expect(h['x-ratelimit-reset']).toMatch(/^\d+$/)
    // Not on a success — it would invite clients to wait when they need not.
    expect(h['retry-after']).toBeUndefined()
  })

  it('emits Retry-After only when refused', () => {
    const refused = decide({ window: 1, count: 99, previousCount: 0 }, 5, 60_000)
    expect(refused.allowed).toBe(false)
    expect(rateLimitHeaders(refused)['retry-after']).toBeDefined()
  })
})

describe('T-114 · the in-memory store is scoped to what it can honestly do', () => {
  it('tracks each key separately', async () => {
    const store = createInMemoryRateLimitStore()
    await store.increment('a', 1, DEFAULT_WINDOW_MS)
    await store.increment('b', 1, DEFAULT_WINDOW_MS)
    expect(store.size()).toBe(2)
  })

  it('carries the previous window forward exactly once', async () => {
    const store = createInMemoryRateLimitStore()
    await store.increment('a', 1, DEFAULT_WINDOW_MS)
    await store.increment('a', 1, DEFAULT_WINDOW_MS)
    const rolled = await store.increment('a', 2, DEFAULT_WINDOW_MS)
    expect(rolled).toEqual({ window: 2, count: 1, previousCount: 2 })

    const rolledAgain = await store.increment('a', 3, DEFAULT_WINDOW_MS)
    expect(rolledAgain.previousCount).toBe(1)
  })

  it('zeroes the previous count across a gap', async () => {
    const store = createInMemoryRateLimitStore()
    await store.increment('a', 1, DEFAULT_WINDOW_MS)
    const jumped = await store.increment('a', 5, DEFAULT_WINDOW_MS)
    expect(jumped.previousCount).toBe(0)
  })

  it('🛑 is documented as unusable on serverless', async () => {
    // Not a style note. On Vercel each warm instance holds its own Map, so a
    // limit of 60 becomes 60 × instances — a number nobody controls and nobody
    // can observe. It does not fail; it stops being a limit under exactly the
    // load that made you want one. The warning has to survive refactoring, so
    // it is asserted.
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const src = readFileSync(path.resolve(process.cwd(), 'lib/domain/rateLimit.ts'), 'utf8')
    expect(src).toMatch(/serverless/i)
    expect(src).toMatch(/SHARED store|shared store/i)
  })
})
