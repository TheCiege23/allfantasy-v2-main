import { describe, expect, it, vi, beforeEach } from 'vitest'

/*
 * `league-rankings-v2` is ~3,500 lines and reaches Sleeper, FantasyCalc and Prisma on import.
 * Mocking it keeps this a unit test of the ADAPTER's null handling, which is the whole subject.
 */
vi.mock('@/lib/rankings-engine/league-rankings-v2', () => ({
  computeLeagueRankingsV2: vi.fn(),
}))

import { getV2Rankings, RankingsUnavailableError } from '@/lib/rankings-engine/v2-adapter'
import { computeLeagueRankingsV2 } from '@/lib/rankings-engine/league-rankings-v2'

const compute = vi.mocked(computeLeagueRankingsV2)

/**
 * `computeLeagueRankingsV2` returns `LeagueRankingsV2Output | null`. The adapter used to write
 * `return (await …) as V2RankingsResult`, casting the null away so the compiler stopped asking —
 * and all four callers dereferenced the result immediately. A null therefore surfaced as
 * `TypeError: Cannot read properties of null`, naming neither the league nor the reason.
 */
describe('getV2Rankings refuses a null compute rather than casting it away', () => {
  beforeEach(() => compute.mockReset())

  it('throws RankingsUnavailableError instead of returning null', async () => {
    compute.mockResolvedValue(null as never)
    await expect(getV2Rankings({ leagueId: 'L1', week: 6 }))
      .rejects.toBeInstanceOf(RankingsUnavailableError)
  })

  it('carries the league and week, so a sweep can name the league it skipped', async () => {
    compute.mockResolvedValue(null as never)
    const err = await getV2Rankings({ leagueId: 'L1', week: 6 }).catch((e) => e)
    expect(err).toMatchObject({ leagueId: 'L1', week: 6 })
    // The message is what reaches a log line, so it has to carry the id too.
    expect(String(err.message)).toContain('L1')
  })

  /*
   * ⚠ THE DISCRIMINATING HALF. Without this, a guard that threw unconditionally would pass both
   * assertions above — the test would prove only that SOMETHING throws, not that the null is what
   * distinguishes the two paths.
   */
  it('passes a real result straight through, so the guard is not simply always-throw', async () => {
    const real = { leagueId: 'L1', season: '2026', week: 6, teams: [] }
    compute.mockResolvedValue(real as never)
    await expect(getV2Rankings({ leagueId: 'L1', week: 6 })).resolves.toBe(real)
  })
})
