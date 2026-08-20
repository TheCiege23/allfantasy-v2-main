import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/lineup-actions/computeLineupActionsForUser', () => ({
  computeLineupActionsForUser: async () => ({ leagues: [] }),
}))
vi.mock('@/lib/decision-os/lineup/shadow', () => ({
  runLineupShadowForSummary: async () => [],
}))

import {
  runLineupShadowSweep,
  shadowSweepEnabled,
  SHADOW_SWEEP_FLAG,
  type ShadowSweepDeps,
} from '@/lib/decision-os/lineup/shadowSweep'

const summary = { leagues: [{ leagueId: 'L1' }] } as never

function deps(over: Partial<ShadowSweepDeps> = {}, clock = { t: 0 }): ShadowSweepDeps {
  return {
    countCandidates: async () => 10,
    listCandidateUserIds: async (limit) => Array.from({ length: limit }, (_, i) => `u${i}`),
    computeSummary: async () => summary,
    runShadow: async () => [{ ran: true, leagueId: 'L1' } as never],
    now: () => clock.t,
    ...over,
  }
}

describe('the gate — off by default', () => {
  it('requires the flag to be exactly "true"', () => {
    expect(shadowSweepEnabled({ [SHADOW_SWEEP_FLAG]: 'true' } as never)).toBe(true)
    for (const v of ['', 'false', '1', 'yes', 'TRUE', undefined]) {
      expect(shadowSweepEnabled({ [SHADOW_SWEEP_FLAG]: v } as never)).toBe(false)
    }
  })

  it('when disabled it touches NOTHING — no count, no list, no compute', async () => {
    // It runs on every tick of a cron that fires ~144x/day. Disabled must mean zero DB work,
    // not "work that is then discarded".
    const count = vi.fn(async () => 10)
    const list = vi.fn(async () => ['u0'])
    const compute = vi.fn(async () => summary)
    const out = await runLineupShadowSweep(
      deps({ countCandidates: count, listCandidateUserIds: list, computeSummary: compute }),
      { enabled: false },
    )
    expect(out.ran).toBe(false)
    expect(out.reason).toBe('sweep_disabled')
    expect(count).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
    expect(compute).not.toHaveBeenCalled()
  })
})

describe('counting', () => {
  it('separates comparisons from skips', async () => {
    const out = await runLineupShadowSweep(
      deps({
        listCandidateUserIds: async () => ['a', 'b', 'c'],
        runShadow: async (userId) =>
          userId === 'b'
            ? ([{ ran: false, leagueId: 'L1', error: 'inputs_unavailable' }] as never)
            : ([{ ran: true, leagueId: 'L1' }] as never),
      }),
    )
    expect(out.comparisons).toBe(2)
    expect(out.skips).toBe(1)
    expect(out.skipReasons).toEqual({ inputs_unavailable: 1 })
  })

  it('reads the skip reason from `error` — LineupShadowResult has no `skipReason`', async () => {
    // The bug this pins: reaching for a field that does not exist buckets every skip as
    // 'unknown', which would make the whole sweep useless as a diagnosis while still looking
    // like it ran fine.
    const out = await runLineupShadowSweep(
      deps({
        listCandidateUserIds: async () => ['a'],
        runShadow: async () => [{ ran: false, leagueId: 'L1', error: 'inputs_unavailable' }] as never,
      }),
    )
    expect(out.skipReasons.unknown).toBeUndefined()
    expect(out.skipReasons).toEqual({ inputs_unavailable: 1 })
  })

  it('truncates unbounded exception messages so the tally cannot shatter', async () => {
    const long = 'x'.repeat(500)
    const out = await runLineupShadowSweep(
      deps({
        listCandidateUserIds: async () => ['a'],
        runShadow: async () => [{ ran: false, leagueId: 'L1', error: long }] as never,
      }),
    )
    expect(Object.keys(out.skipReasons)[0]).toHaveLength(60)
  })

  it('counts a user with no leagues as a skip, without calling the shadow', async () => {
    const run = vi.fn(async () => [] as never)
    const out = await runLineupShadowSweep(
      deps({
        listCandidateUserIds: async () => ['a'],
        computeSummary: async () => ({ leagues: [] }) as never,
        runShadow: run,
      }),
    )
    expect(run).not.toHaveBeenCalled()
    expect(out.skipReasons).toEqual({ no_leagues: 1 })
  })
})

describe('it never throws, and never gives up early', () => {
  it('one user failing does not abort the rest', async () => {
    // Otherwise a single league with bad data blocks every user ordered after it forever, and
    // the rotation keeps returning to it.
    const out = await runLineupShadowSweep(
      deps({
        listCandidateUserIds: async () => ['a', 'b', 'c'],
        computeSummary: async (u) => {
          if (u === 'a') throw new Error('bad league')
          return summary
        },
      }),
    )
    expect(out.errors).toBe(1)
    expect(out.comparisons).toBe(2)
    expect(out.ran).toBe(true)
  })

  it('returns a result rather than throwing when the datastore is down', async () => {
    const out = await runLineupShadowSweep(
      deps({ countCandidates: async () => { throw new Error('db down') } }),
    )
    expect(out.ran).toBe(false)
    expect(out.reason).toBe('db down')
  })

  it('handles an empty population', async () => {
    const out = await runLineupShadowSweep(deps({ countCandidates: async () => 0 }))
    expect(out.reason).toBe('no_candidates')
  })
})

describe('cost control', () => {
  it('stops at the wall-clock budget mid-batch', async () => {
    // The host route declares maxDuration 60 and has other work to do; a Vercel duration kill
    // runs no user code at all.
    const clock = { t: 0 }
    const out = await runLineupShadowSweep(
      deps(
        {
          listCandidateUserIds: async () => ['a', 'b', 'c', 'd'],
          computeSummary: async () => { clock.t += 900; return summary },
        },
        clock,
      ),
      { budgetMs: 1_000 },
    )
    expect(out.comparisons).toBeLessThan(4)
  })
})

describe('rotation covers the population without persisting a cursor', () => {
  it('advances the offset as the clock advances', async () => {
    const seen: number[] = []
    for (const t of [0, 10 * 60 * 1000, 20 * 60 * 1000]) {
      const clock = { t }
      const out = await runLineupShadowSweep(
        deps({ countCandidates: async () => 30, listCandidateUserIds: async () => ['a'] }, clock),
        { batch: 3 },
      )
      seen.push(out.offset)
    }
    expect(seen).toEqual([0, 3, 6])
  })

  it('wraps rather than running off the end of the population', async () => {
    const clock = { t: 100 * 10 * 60 * 1000 }
    const out = await runLineupShadowSweep(
      deps({ countCandidates: async () => 7, listCandidateUserIds: async () => ['a'] }, clock),
      { batch: 3 },
    )
    expect(out.offset).toBeGreaterThanOrEqual(0)
    expect(out.offset).toBeLessThan(7)
  })
})
