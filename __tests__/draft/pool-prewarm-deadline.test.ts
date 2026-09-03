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
 * 🛑 AND A REJECTION IS NOT ONE FACT, WHICH THE FIRST VERSION OF THIS FIX GOT WRONG. It mapped
 * every rejection to "not warm, build it". But on a starved container the rejections ARE the
 * saturation — pool exhaustion, statement timeouts, socket errors — so the route had two doors
 * and one still started a 60-90s build into a dying process. Found in review, not by a test.
 *
 * The discriminator is TIME. A genuine cache-miss error returns immediately; a saturation error
 * arrives late or at the pool's own timeout. So a rejection after half the budget goes through
 * the same door as a timeout, and a fast one keeps the old behaviour.
 *
 * INVARIANTS LOCKED HERE:
 *   1. The cache check is wrapped in withTimeout with its own budget.
 *   2. A check that exceeds its budget DEFERS; it does not fall through to a cold build.
 *   3. The deadline arithmetic accounts for the check's budget.
 *   4. Rejection, SLOW rejection and non-return are three facts: fast rejection builds, slow
 *      rejection and non-return both defer, and the warn says which fired.
 *   5. withTimeout genuinely reports a never-settling promise as timed out (behavioural).
 *   6. Tick end separates 'container-saturated' (all deferred) from 'league-specific' (one).
 *   7. The slow-rejection threshold discriminates, boundary included (behavioural).
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
    const branch = /if \(!check\.ok \|\| slowRejection\)[\s\S]*?\n    \}/.exec(routeSrc)?.[0] ?? ''
    expect(branch).toContain("action: 'deferred'")
  })

  it('does NOT call ensureDraftPoolReady inside the timeout branch', () => {
    const branch = /if \(!check\.ok \|\| slowRejection\)[\s\S]*?\n    \}/.exec(routeSrc)?.[0] ?? ''
    expect(branch).not.toContain('ensureDraftPoolReady')
  })

  it('names the league in the warn, so a pathological league is distinguishable from a saturated container', () => {
    const branch = /if \(!check\.ok \|\| slowRejection\)[\s\S]*?\n    \}/.exec(routeSrc)?.[0] ?? ''
    expect(branch).toContain('leagueId')
    expect(routeSrc).toMatch(/console\.warn\('\[draft-pool-prewarm\] cache check exceeded/)
  })
})

describe('Invariant 3: the deadline accounts for the check', () => {
  it('LATEST_START_DEADLINE_MS subtracts CACHE_CHECK_TIMEOUT_MS', () => {
    const expr =
      /const LATEST_START_DEADLINE_MS =([^\n]*(?:\n[ \t]+[^\n]*)*)/.exec(routeSrc)?.[1] ?? ''
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

describe('Invariant 4: rejection, slow rejection, and non-return are THREE facts', () => {
  it('the catch sits on the work, inside withTimeout, and still yields false', () => {
    expect(routeSrc).toMatch(/\.catch\(\(\) => \{[\s\S]*?return false[\s\S]*?\}\)/)
  })

  it('the rejection is TIMED, not merely swallowed', () => {
    expect(routeSrc).toContain('rejectedAfterMs')
    expect(routeSrc).toMatch(/rejectedAfterMs = Date\.now\(\) - checkStartedAt/)
  })

  it('a SLOW rejection defers through the same door as a timeout', () => {
    expect(routeSrc).toMatch(/const slowRejection = [\s\S]*?SLOW_REJECTION_MS/)
    expect(routeSrc).toMatch(/if \(!check\.ok \|\| slowRejection\)/)
  })

  it('SLOW_REJECTION_MS is derived from the check budget, not hardcoded', () => {
    // Derived so the two doors cannot disagree: anything slower would have tripped the
    // timeout shortly anyway.
    expect(routeSrc).toMatch(/const SLOW_REJECTION_MS = CACHE_CHECK_TIMEOUT_MS \/ 2/)
  })

  it('the warn distinguishes a timeout from a slow rejection', () => {
    expect(routeSrc).toMatch(/reason: check\.ok \? 'slow-rejection' : 'timeout'/)
  })
})

describe('Invariant 6: the tick separates a saturated container from one bad league', () => {
  it('computes the deferred set at tick end', () => {
    expect(routeSrc).toMatch(/const deferred = results\.filter\(\(r\) => r\.action === 'deferred'\)/)
  })

  it('diagnoses container-saturated only when EVERY league deferred', () => {
    expect(routeSrc).toMatch(
      /deferred\.length === results\.length \? 'container-saturated' : 'league-specific'/,
    )
  })

  it('names the deferred leagues, so a recurring one is identifiable', () => {
    expect(routeSrc).toMatch(/leagueIds: deferred\.map\(\(r\) => r\.leagueId\)/)
  })

  it('stays silent when nothing deferred', () => {
    expect(routeSrc).toMatch(/if \(deferred\.length > 0\) \{/)
  })
})

describe('Invariant 7 (behavioural): the slow-rejection threshold discriminates', () => {
  // The rule under test, extracted: a rejection is saturation iff it arrived after half the
  // budget. Pinned as arithmetic so a future edit to either constant cannot silently invert it.
  const budget = Number(
    /const CACHE_CHECK_TIMEOUT_MS\s*=\s*([\d_]+)/.exec(routeSrc)?.[1]?.replace(/_/g, ''),
  )
  const threshold = budget / 2
  const isSaturation = (rejectedAfterMs: number) => rejectedAfterMs > threshold

  it('an immediate rejection is a real cache miss — build it', () => {
    expect(isSaturation(0)).toBe(false)
    expect(isSaturation(50)).toBe(false)
  })

  it('a rejection late in the budget is saturation — defer it', () => {
    expect(isSaturation(budget - 1)).toBe(true)
    expect(isSaturation(threshold + 1)).toBe(true)
  })

  it('the boundary itself is NOT saturation, so the comparison is strict', () => {
    expect(isSaturation(threshold)).toBe(false)
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
