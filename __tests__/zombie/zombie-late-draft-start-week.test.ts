import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A ZOMBIE LEAGUE DRAFTED MID-SEASON SAT AT WEEK 1 FOREVER.
 *
 * Zombie was pinned to a week-1 start, so its schedule began with weeks played before anyone drafted.
 * The finalizer looks back only a few weeks, so week 1 never sealed and the zombie week never resolved.
 * A zombie season now starts on the sport's next unplayed week, like the standard formats — without
 * joining `STANDARD_WEEKLY_SEASON_FORMATS`, which would also hand it to the round-robin roller.
 */

const h = vi.hoisted(() => ({
  matchupCount: vi.fn(),
  leagueFindUnique: vi.fn(),
  resolveSeasonStartWeek: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftMatchup: { count: h.matchupCount },
    league: { findUnique: h.leagueFindUnique },
  },
}))
vi.mock('@/lib/redraft/seasonStartWeek', () => ({ resolveSeasonStartWeek: h.resolveSeasonStartWeek }))

import { resolveStartWeekForFreshSeason } from '@/lib/redraft/finalizeDraftToRedraftSeason'
import { STANDARD_WEEKLY_SEASON_FORMATS } from '@/lib/season-week/standardSeasonScope'

const season = { id: 's1', sport: 'NBA', season: 2026, totalWeeks: 22, playoffStartWeek: 20 }
const leagueOf = (leagueType: string) => ({ leagueType, bbContestId: null, bestBallMode: false, settings: {} })

beforeEach(() => {
  vi.clearAllMocks()
  h.matchupCount.mockResolvedValue(0)
  // Drafted in mid-November: the NBA's next unplayed week is week 6.
  h.resolveSeasonStartWeek.mockResolvedValue({ startWeek: 6 })
})

describe('resolveStartWeekForFreshSeason', () => {
  it('a zombie league drafted mid-season starts on the current week', async () => {
    h.leagueFindUnique.mockResolvedValue(leagueOf('zombie'))
    await expect(resolveStartWeekForFreshSeason('L1', season)).resolves.toBe(6)
    expect(h.resolveSeasonStartWeek).toHaveBeenCalledWith({ sport: 'NBA', seasonYear: 2026, regularSeasonEnd: 19 })
  })

  it('[control] a redraft league starts the same way it always did', async () => {
    h.leagueFindUnique.mockResolvedValue(leagueOf('redraft'))
    await expect(resolveStartWeekForFreshSeason('L1', season)).resolves.toBe(6)
  })

  it('[control] a format with its own week engine still starts at 1', async () => {
    h.leagueFindUnique.mockResolvedValue(leagueOf('guillotine'))
    await expect(resolveStartWeekForFreshSeason('L1', season)).resolves.toBe(1)
    expect(h.resolveSeasonStartWeek).not.toHaveBeenCalled()
  })

  it('[control] a season that already has a schedule is left alone', async () => {
    h.matchupCount.mockResolvedValue(40)
    h.leagueFindUnique.mockResolvedValue(leagueOf('zombie'))
    await expect(resolveStartWeekForFreshSeason('L1', season)).resolves.toBe(1)
  })

  it('zombie is NOT a standard weekly format, so the roller and playoff runtime still leave it alone', () => {
    expect(STANDARD_WEEKLY_SEASON_FORMATS.has('zombie')).toBe(false)
  })
})
