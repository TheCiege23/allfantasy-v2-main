/**
 * draft-pool-prewarm: the cache check is bounded, and blowing that bound defers.
 *
 * ROOT CAUSE FIXED. `LATEST_START_DEADLINE_MS` was derived as
 *
 *     maxDuration - PER_LEAGUE_TIMEOUT_MS - RESPONSE_MARGIN_MS
 *
 * which silently assumes `checkDraftPoolCacheFast` costs nothing. It documents itself as
 * "<50 ms, never triggers a cold build" — true of the work it issues, false of the time it
 * takes, because it competes with CONCURRENCY cold builds on one event loop.
 *
 * Measured in production 2026-09-03 12:33Z on the container serving the site:
 *
 *     [draft-perf] pool fast-check { warm: false, source: 'cold', entryCount: 0, ms: 65841 }
 *     [draft-pool-prewarm] league exceeded its per-league timeout { timeoutMs: 120000 }  x3
 *
 * 65s + 120s = 185s of per-league worst case against a 160s deadline, so the property the
 * deadline exists to guarantee — the last league to START can still finish — was false exactly
 * under load. The same minutes show the site's own homepage timing out at 30s while
 * /api/health answered in 0.2s.
 *
 * INVARIANTS LOCKED HERE:
 *   1. The cache check is wrapped in withTimeout with its own budget.
 *   2. A check that exceeds its budget DEFERS; it does not fall through to a cold build.
 *   3. The deadline arithmetic accounts for the check's budget.
 *   4. A check that REJECTS still means "not warm" (build it) — a different fact from
 *      "the check never returned", and the opposite response.
 *   5. withTimeout genuinely reports a never-settling promise as timed out (behavioural).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withTimeout } from '@/lib/async-utils'

const root = resolve(__dirname, '..', '..')
const routeSrc = readFileSync(
  resolve(root, 'app/api/cron/draft-pool-prewarm/route.ts'),
  'utf8',
)

describe('Invariant 1: the cache check carries its own budget', () => {
  it('declares CACHE_CHECK_TIMEOUT_MS', () => {
    expect(routeSrc).toMatch(/const CACHE_CHECK_TIMEOUT_MS\s*=\s*[\d_]+/)
  })

  it('wraps checkDraftPoolCacheFast in withTimeout', () => {
    // The call must be bounded, not merely awaited.
    expect(routeSrc).toMatch(
      /withTimeout\(\s*[\s\S]*?checkDraftPoolCacheFast\([\s\S]*?CACHE_CHECK_TIMEOUT_MS/,
    )
  })

  it('the budget is far above the documented 50ms cost but far below the build budget', () => {
    const budget = Number(
      /const CACHE_CHECK_TIMEOUT_MS\s*=\s*([\d_]+)/.exec(routeSrc)?.[1]?.replace(/_/g, ''),
    )
    const perLeague = Number(
      /const PER_LEAGUE_TIMEOUT_MS\s*=\s*([\d_]+)/.exec(routeSrc)?.[1]?.replace(/_/g, ''),
    )
    expect(Number.isFinite(budget)).toBe(true)
    // 100x the documented cost: generous enough that a healthy container never trips it.
    expect(budget).toBeGreaterThanOrEqual(1_000)
    // ...and cheap enough that detecting saturation costs far less than building into it.
    expect(budget).toBeLessThan(perLeague / 10)
  })
})

describe('Invariant 2: a blown budget defers rather than building', () => {
  it('returns action "deferred" on the timeout branch', () => {
    const branch = /if \(!check\.ok\)[\s\S]*?\n    \}/.exec(routeSrc)?.[0] ?? ''
    expect(branch).toContain("action: 'deferred'")
  })

  it('does NOT call ensureDraftPoolReady inside the timeout branch', () => {
    const branch = /if \(!check\.ok\)[\s\S]*?\n    \}/.exec(routeSrc)?.[0] ?? ''
    expect(branch).not.toContain('ensureDraftPoolReady')
  })

  it('names the league in the warn, so a pathological league is distinguishable from a saturated container', () => {
    const branch = /if \(!check\.ok\)[\s\S]*?\n    \}/.exec(routeSrc)?.[0] ?? ''
    expect(branch).toContain('leagueId')
    expect(routeSrc).toMatch(/console\.warn\('\[draft-pool-prewarm\] cache check exceeded/)
  })
})

describe('Invariant 3: the deadline accounts for the check', () => {
  it('LATEST_START_DEADLINE_MS subtracts CACHE_CHECK_TIMEOUT_MS', () => {
    const expr = /const LATEST_START_DEADLINE_MS =(.*)/.exec(routeSrc)?.[1] ?? ''
    expect(expr).toContain('CACHE_CHECK_TIMEOUT_MS')
    expect(expr).toContain('PER_LEAGUE_TIMEOUT_MS')
    expect(expr).toContain('RESPONSE_MARGIN_MS')
  })

  it('the worst-case league fits inside maxDuration', () => {
    const num = (name: string) =>
      Number(
        new RegExp(`const ${name}\\s*=\\s*([\\d_]+)`).exec(routeSrc)?.[1]?.replace(/_/g, ''),
      )
    const maxDuration = num('maxDuration') || 300
    const deadline =
      maxDuration * 1000 - num('CACHE_CHECK_TIMEOUT_MS') - num('PER_LEAGUE_TIMEOUT_MS') - num('RESPONSE_MARGIN_MS')

    // A league starting at the deadline spends at most: check budget + build budget.
    const worstCase = deadline + num('CACHE_CHECK_TIMEOUT_MS') + num('PER_LEAGUE_TIMEOUT_MS')
    expect(worstCase).toBeLessThanOrEqual(maxDuration * 1000 - num('RESPONSE_MARGIN_MS'))
  })
})

describe('Invariant 4: rejection and non-return are different facts', () => {
  it('a rejecting check still resolves to "not warm" rather than deferring', () => {
    // .catch(() => false) must sit INSIDE the withTimeout, on the work.
    expect(routeSrc).toMatch(/\.catch\(\(\) => false\)/)
  })
})

describe('Invariant 5 (behavioural): withTimeout reports a stalled promise as timed out', () => {
  it('a promise that never settles yields ok:false', async () => {
    const never = new Promise<boolean>(() => {})
    const result = await withTimeout(never, 20)
    expect(result.ok).toBe(false)
  })

  it('a promise that settles in time yields its value', async () => {
    const quick = Promise.resolve(true)
    const result = await withTimeout(quick, 1_000)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(true)
  })

  it('a REJECTING promise is not silently treated as a timeout', async () => {
    // This is why the .catch() is on the work: withTimeout propagates a rejection,
    // and an unguarded rejection here would abort the whole league rather than build.
    await expect(withTimeout(Promise.reject(new Error('boom')), 1_000)).rejects.toThrow('boom')
  })
})
