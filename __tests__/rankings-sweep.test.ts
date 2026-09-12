import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/rankings-engine/v2-adapter', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rankings-engine/v2-adapter')>(
    '@/lib/rankings-engine/v2-adapter',
  )
  return { ...actual, getV2Rankings: vi.fn() }
})
vi.mock('@/lib/rankings-engine/snapshots', () => ({ saveRankingsSnapshot: vi.fn() }))

import {
  runRankingsSweep,
  RANKINGS_SWEEP_FLAG,
  type RankingsSweepCounts,
} from '@/lib/rankings-engine/rankingsSweep'
import { getV2Rankings, RankingsUnavailableError } from '@/lib/rankings-engine/v2-adapter'
import { saveRankingsSnapshot } from '@/lib/rankings-engine/snapshots'

const compute = vi.mocked(getV2Rankings)
const save = vi.mocked(saveRankingsSnapshot)

/** A budget that never runs out unless a test says so. */
function budget(exhausted = false, remainingMs = 240_000) {
  return { startedAt: 0, exhausted: () => exhausted, remainingMs: () => remainingMs }
}

/** Minimal prisma double: N sleeper leagues, and a snapshot freshness answer per league. */
function fakePrisma(ids: string[], freshness: Record<string, Date | null> = {}) {
  const leagueFindMany = vi.fn(async () => ids.map((platformLeagueId) => ({ platformLeagueId })))
  const snapshotFindFirst = vi.fn(async ({ where }: { where: { leagueId: string } }) => {
    const at = freshness[where.leagueId]
    return at ? { createdAt: at } : null
  })
  return {
    prisma: { league: { findMany: leagueFindMany }, rankingsSnapshot: { findFirst: snapshotFindFirst } },
    leagueFindMany,
    snapshotFindFirst,
  }
}

function rankings(teams: number, season = '2026', week = 3) {
  return {
    season,
    week,
    teams: Array.from({ length: teams }, (_, i) => ({
      rosterId: String(i + 1), rank: i + 1, composite: 100 - i, expectedWins: 7, luckDelta: 0,
    })),
  }
}

const ORIGINAL = process.env[RANKINGS_SWEEP_FLAG]
beforeEach(() => {
  compute.mockReset(); save.mockReset()
  process.env[RANKINGS_SWEEP_FLAG] = 'true'
})
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[RANKINGS_SWEEP_FLAG]
  else process.env[RANKINGS_SWEEP_FLAG] = ORIGINAL
})

describe('the flag is read at the boundary', () => {
  /*
   * ⚠ THIS ASSERTS A COST, NOT A RESULT. "Returns zeroes when disabled" would pass even if the
   * sweep queried every league and called Sleeper first. The claim in the header is that flag-off
   * costs NOTHING, so the test has to be that the deps were never touched.
   */
  it('queries nothing and calls nothing when disabled', async () => {
    process.env[RANKINGS_SWEEP_FLAG] = 'false'
    const f = fakePrisma(['a', 'b'])
    const out = await runRankingsSweep({ prisma: f.prisma as never, budget: budget() })
    expect(f.leagueFindMany).not.toHaveBeenCalled()
    expect(compute).not.toHaveBeenCalled()
    expect(out.considered).toBe(0)
  })

  it('an unset flag is disabled, not enabled', async () => {
    delete process.env[RANKINGS_SWEEP_FLAG]
    const f = fakePrisma(['a'])
    await runRankingsSweep({ prisma: f.prisma as never, budget: budget() })
    expect(f.leagueFindMany).not.toHaveBeenCalled()
  })
})

describe('due-ness is a read, not a guess', () => {
  it('skips a league whose snapshot is inside the TTL, without calling Sleeper', async () => {
    const fresh = new Date(Date.now() - 60 * 60 * 1000) // 1h old, TTL is 18h
    const f = fakePrisma(['L1'], { L1: fresh })
    const out = await runRankingsSweep({ prisma: f.prisma as never, budget: budget() })
    expect(compute).not.toHaveBeenCalled()
    expect(out.due).toBe(0)
    expect(out.written).toBe(0)
  })

  it('ranks a league whose snapshot is older than the TTL', async () => {
    const stale = new Date(Date.now() - 20 * 60 * 60 * 1000) // 20h old
    const f = fakePrisma(['L1'], { L1: stale })
    compute.mockResolvedValue(rankings(12) as never)
    const out = await runRankingsSweep({ prisma: f.prisma as never, budget: budget() })
    expect(compute).toHaveBeenCalledOnce()
    expect(out.due).toBe(1)
    expect(out.written).toBe(1)
  })

  it('ranks a league that has never been snapshotted', async () => {
    const f = fakePrisma(['L1'])
    compute.mockResolvedValue(rankings(10) as never)
    const out = await runRankingsSweep({ prisma: f.prisma as never, budget: budget() })
    expect(out.written).toBe(1)
  })
})

describe('the week is derived, never pinned', () => {
  /*
   * 🛑 THE REGRESSION THIS PINS. `computeLeagueRankingsV2` resolves the week as
   * `currentWeek ?? settings.week`, and `??` is NULLISH — so passing `0` to satisfy a required
   * field silently pins every snapshot to week 0. Nothing objects: 0 is a valid Int and the row
   * writes. The sweep must omit the week entirely.
   */
  it('calls getV2Rankings without a week', async () => {
    const f = fakePrisma(['L1'])
    compute.mockResolvedValue(rankings(12) as never)
    await runRankingsSweep({ prisma: f.prisma as never, budget: budget() })
    expect(compute).toHaveBeenCalledWith({ leagueId: 'L1' })
    expect(compute.mock.calls[0]?.[0]).not.toHaveProperty('week')
  })

  it('writes the season and week the engine reported, not a default', async () => {
    const f = fakePrisma(['L1'])
    compute.mockResolvedValue(rankings(12, '2026', 7) as never)
    await runRankingsSweep({ prisma: f.prisma as never, budget: budget() })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ season: '2026', week: 7 }))
  })
})

describe('per-league outcomes are classified, not lumped', () => {
  it('an unavailable league is SKIPPED and the walk continues', async () => {
    const f = fakePrisma(['L1', 'L2'])
    compute
      .mockRejectedValueOnce(new RankingsUnavailableError('L1', null))
      .mockResolvedValueOnce(rankings(12) as never)
    const out = await runRankingsSweep({ prisma: f.prisma as never, budget: budget() })
    expect(out.skipped).toBe(1)
    expect(out.written).toBe(1)
    expect(out.failed).toBe(0)
  })

  it('an unexpected error is FAILED, and still does not end the walk', async () => {
    const f = fakePrisma(['L1', 'L2'])
    compute
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(rankings(12) as never)
    const out = await runRankingsSweep({ prisma: f.prisma as never, budget: budget() })
    expect(out.failed).toBe(1)
    expect(out.written).toBe(1)
    expect(out.errors[0]).toContain('socket hang up')
  })

  /*
   * 🛑 THE SILENT SEAM. `saveRankingsSnapshot` runs `prisma.$transaction(teams.map(...))`, so an
   * empty array RESOLVES having written nothing. Calling it would count a write that never
   * happened — which is the exact shape that let three tables sit empty unnoticed.
   */
  it('a zero-team league is refused, and save is never called', async () => {
    const f = fakePrisma(['L1'])
    compute.mockResolvedValue(rankings(0) as never)
    const out = await runRankingsSweep({ prisma: f.prisma as never, budget: budget() })
    expect(save).not.toHaveBeenCalled()
    expect(out.emptyRoster).toBe(1)
    expect(out.written).toBe(0)
  })
})

describe('bounds', () => {
  it('attempts no more than the per-fire cap', async () => {
    const f = fakePrisma(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    compute.mockResolvedValue(rankings(12) as never)
    const out = await runRankingsSweep({ prisma: f.prisma as never, budget: budget(), leagueCap: 3 })
    expect(compute).toHaveBeenCalledTimes(3)
    expect(out.written).toBe(3)
    expect(out.considered).toBe(7)
  })

  it('an exhausted budget stops the walk and REPORTS the remainder', async () => {
    const f = fakePrisma(['a', 'b', 'c'])
    const out = await runRankingsSweep({ prisma: f.prisma as never, budget: budget(true) })
    expect(compute).not.toHaveBeenCalled()
    // Not silently truncated — the leagues not reached are counted.
    expect(out.skippedForTime).toBe(3)
  })

  it('refuses to START a league that cannot finish in the time left', async () => {
    const f = fakePrisma(['a', 'b'])
    // Under remainingFor's 1s floor: not exhausted, but nothing can usefully run.
    const out = await runRankingsSweep({ prisma: f.prisma as never, budget: budget(false, 500) })
    expect(compute).not.toHaveBeenCalled()
    expect(out.skippedForTime).toBe(2)
  })

  it('de-duplicates a platform league id imported by two users', async () => {
    const f = fakePrisma(['SAME', 'SAME', 'OTHER'])
    compute.mockResolvedValue(rankings(12) as never)
    const out = await runRankingsSweep({ prisma: f.prisma as never, budget: budget() })
    expect(out.considered).toBe(2)
    expect(compute).toHaveBeenCalledTimes(2)
  })
})

describe('the league query is scoped', () => {
  it('asks only for live Sleeper NFL leagues', async () => {
    const f = fakePrisma(['L1'])
    compute.mockResolvedValue(rankings(12) as never)
    await runRankingsSweep({ prisma: f.prisma as never, budget: budget() })
    const where = (f.leagueFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> } | undefined)?.where
    expect(where).toMatchObject({ platform: 'sleeper', sport: 'NFL' })
    // Finished leagues are excluded rather than ranked.
    expect(JSON.stringify(where)).toContain('ARCHIVED')
  })
})
