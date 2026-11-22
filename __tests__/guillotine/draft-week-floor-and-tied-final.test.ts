/**
 * Two season-ending fixes (2026-10-29): a league's first chop is the week after its draft, and a
 * tied final is settled by season points instead of waiting forever for a commissioner.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  draftSession: { findFirst: vi.fn() },
  guillotineSeason: { findFirst: vi.fn() },
  league: { findUnique: vi.fn() },
  roster: { findMany: vi.fn() },
  guillotinePeriodScore: { findMany: vi.fn() },
}))
const weekAt = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/guillotine/lateStartSeats', () => ({ guillotineFantasyWeekAt: weekAt }))

import { firstChopWeekAfterDraft } from '@/lib/guillotine/draftWeekFloor'
import { determineFinalChampion } from '@/lib/guillotine/endgameEngine'

beforeEach(() => vi.clearAllMocks())

describe('firstChopWeekAfterDraft', () => {
  it('is the week after the week the draft completed in', async () => {
    const completedAt = new Date('2026-11-12T01:00:00Z')
    db.draftSession.findFirst.mockResolvedValue({ completedAt })
    weekAt.mockResolvedValue(10)
    expect(await firstChopWeekAfterDraft({ leagueId: 'L1', sport: 'NFL', season: 2026 })).toBe(11)
    expect(weekAt).toHaveBeenCalledWith('NFL', 2026, completedAt)
    expect(db.draftSession.findFirst.mock.calls[0]![0].where).toMatchObject({ leagueId: 'L1', status: 'completed' })
  })

  it('a draft before week 1 allows a week-1 chop; no draft or no calendar leaves it to the config', async () => {
    db.draftSession.findFirst.mockResolvedValue({ completedAt: new Date() })
    weekAt.mockResolvedValue(0)
    expect(await firstChopWeekAfterDraft({ leagueId: 'L1', sport: 'NBA', season: 2026 })).toBe(1)
    weekAt.mockResolvedValue(null)
    expect(await firstChopWeekAfterDraft({ leagueId: 'L1', sport: 'NBA', season: 2026 })).toBeNull()
    db.draftSession.findFirst.mockResolvedValue(null)
    expect(await firstChopWeekAfterDraft({ leagueId: 'L1', sport: 'NBA', season: 2026 })).toBeNull()
  })
})

describe('determineFinalChampion — a tied final', () => {
  function arrangeFinal(seasonBefore: Record<string, number>) {
    db.guillotineSeason.findFirst.mockResolvedValue({
      leagueId: 'L1', season: 2026, finalStageStartPeriod: 16, currentScoringPeriod: 18,
      redraftSeason: { rosters: [{ id: 'rr-a' }, { id: 'rr-b' }] },
    })
    db.league.findUnique.mockResolvedValue({ settings: {}, guillotineEndgame: 'final_two' })
    db.roster.findMany.mockResolvedValue([{ id: 'R-a', redraftRosterId: 'rr-a' }, { id: 'R-b', redraftRosterId: 'rr-b' }])
    const finalWeeks = [16, 17, 18].flatMap((w) => [
      { rosterId: 'R-a', weekOrPeriod: w, periodPoints: 100 },
      { rosterId: 'R-b', weekOrPeriod: w, periodPoints: 100 },
    ])
    const earlier = Object.entries(seasonBefore).map(([rosterId, periodPoints]) => ({ rosterId, weekOrPeriod: 5, periodPoints }))
    db.guillotinePeriodScore.findMany.mockResolvedValue([...earlier, ...finalWeeks])
  }

  it('goes to the finalist with more season points', async () => {
    arrangeFinal({ 'R-a': 900, 'R-b': 1100 })
    expect(await determineFinalChampion('g1')).toBe('rr-b')
    // The whole season is read, not only the final weeks.
    expect(db.guillotinePeriodScore.findMany.mock.calls[0]![0].where).toEqual({ leagueId: 'L1', season: 2026, rosterId: { in: ['R-a', 'R-b'] } })
  })

  it('stays unresolved only when the season totals tie too', async () => {
    arrangeFinal({ 'R-a': 1000, 'R-b': 1000 })
    expect(await determineFinalChampion('g1')).toBeNull()
  })
})
