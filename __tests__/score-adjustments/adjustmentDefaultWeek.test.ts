/**
 * The score adjustments card opens on the season's CURRENT week.
 *
 * It used to open on the latest week with an active or final game. In a league with no stat feed the
 * current week's games are still `scheduled`, so the card opened on the week before and "Mark final"
 * was a dropdown away.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  redraftMatchup: { findMany: vi.fn(), findFirst: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false) }))
vi.mock('@/lib/redraft/standingsEngine', () => ({ updateStandings: vi.fn(async () => ({})) }))

import { defaultAdjustmentWeek, readAdjustmentWeek } from '@/lib/score-adjustments/scoreAdjustmentService'

const WEEKS = [1, 2, 3, 4]

describe('defaultAdjustmentWeek', () => {
  it('🛑 opens on the current week even when none of its games has started', () => {
    // Weeks 1 and 2 are final, week 3 is the current one and still scheduled.
    expect(defaultAdjustmentWeek({ asked: null, weeks: WEEKS, currentWeek: 3, latestPlayed: 2 })).toBe(3)
  })
  it('a week that was asked for wins, when it is on the schedule', () => {
    expect(defaultAdjustmentWeek({ asked: '2', weeks: WEEKS, currentWeek: 3, latestPlayed: 2 })).toBe(2)
    expect(defaultAdjustmentWeek({ asked: 9, weeks: WEEKS, currentWeek: 3, latestPlayed: 2 })).toBe(3)
    expect(defaultAdjustmentWeek({ asked: 'x', weeks: WEEKS, currentWeek: 3, latestPlayed: 2 })).toBe(3)
  })
  it('no current week on the schedule (before the draft, after the last week): the latest played, then the first', () => {
    expect(defaultAdjustmentWeek({ asked: null, weeks: WEEKS, currentWeek: 0, latestPlayed: 2 })).toBe(2)
    expect(defaultAdjustmentWeek({ asked: null, weeks: WEEKS, currentWeek: 23, latestPlayed: 4 })).toBe(4)
    expect(defaultAdjustmentWeek({ asked: null, weeks: WEEKS, currentWeek: null, latestPlayed: null })).toBe(1)
    expect(defaultAdjustmentWeek({ asked: null, weeks: [], currentWeek: null, latestPlayed: null })).toBe(1)
  })
  it('a missing week is not read as week 0', () => {
    expect(defaultAdjustmentWeek({ asked: '', weeks: [0, 1, 2], currentWeek: 2, latestPlayed: 1 })).toBe(2)
    expect(defaultAdjustmentWeek({ asked: null, weeks: [0, 1, 2], currentWeek: 2, latestPlayed: 1 })).toBe(2)
    expect(defaultAdjustmentWeek({ asked: 0, weeks: [0, 1, 2], currentWeek: 2, latestPlayed: 1 })).toBe(0)
  })
})

describe('readAdjustmentWeek', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.league.findUnique.mockResolvedValue({ settings: { scoring_mode: 'points' } })
    db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', currentWeek: 3 })
    db.redraftMatchup.findFirst.mockResolvedValue({ week: 2 })
    db.redraftMatchup.findMany.mockImplementation(async (args: { distinct?: string[]; where: { week?: number } }) =>
      args.distinct
        ? WEEKS.map((week) => ({ week }))
        : [{ id: `m-${args.where.week}`, status: 'scheduled', homeRosterId: 'h', awayRosterId: 'a', homeScore: 0, awayScore: 0, homeRoster: { teamName: 'Hawks', ownerName: 'h' }, awayRoster: { teamName: 'Owls', ownerName: 'a' } }],
    )
  })

  it('with no week asked for, returns the current week and its games', async () => {
    const view = await readAdjustmentWeek('L', null)
    expect(view).toMatchObject({ week: 3, weeks: WEEKS })
    expect(view?.matchups.map((m) => m.matchupId)).toEqual(['m-3'])
    expect(db.redraftSeason.findFirst.mock.calls[0][0].select).toMatchObject({ currentWeek: true })
  })
  it('still returns the week that was asked for', async () => {
    expect((await readAdjustmentWeek('L', '1'))?.week).toBe(1)
  })
})
