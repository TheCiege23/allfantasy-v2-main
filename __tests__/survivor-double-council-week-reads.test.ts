/**
 * Screens on a double-elimination week: "the council for this week" is the one in progress, and
 * each council knows which of the week's votes it is.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({ survivorTribalCouncil: { findFirst: vi.fn(), count: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn(async () => ({ configId: 'cfg' })) }))

import { getCouncil } from '@/lib/survivor/SurvivorTribalCouncilService'
import { loadCouncilWeekPosition } from '@/lib/survivor/survivorWeekCouncilProgress'
import { buildSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'
import { doubleEliminationWeeks } from '@/lib/survivor/survivorEliminationSchedule'

beforeEach(() => vi.clearAllMocks())

describe('getCouncil on a week with two councils', () => {
  it('returns the open council, newest first, ahead of a revealed earlier one', async () => {
    db.survivorTribalCouncil.findFirst.mockResolvedValueOnce({ id: 'second', councilNumber: 2 })
    expect(await getCouncil('league', 9)).toMatchObject({ id: 'second' })
    expect(db.survivorTribalCouncil.findFirst).toHaveBeenCalledTimes(1)
    expect(db.survivorTribalCouncil.findFirst.mock.calls[0][0]).toMatchObject({
      where: { configId: 'cfg', week: 9, isRevealed: false, status: { not: 'cancelled' } },
      orderBy: [{ councilNumber: 'desc' }],
    })
  })

  it('falls back to the latest council once every council that week has been read', async () => {
    db.survivorTribalCouncil.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'second', councilNumber: 2 })
    expect(await getCouncil('league', 9)).toMatchObject({ id: 'second' })
    expect(db.survivorTribalCouncil.findFirst.mock.calls[1][0]).toMatchObject({ where: { configId: 'cfg', week: 9 }, orderBy: [{ councilNumber: 'desc' }] })
  })
})

describe('loadCouncilWeekPosition', () => {
  const plan = buildSurvivorFullSeasonPlan({ sport: 'NBA', season: 2026, castSize: 24, now: new Date('2027-01-10T12:00:00Z') })
  const doubleWeek = doubleEliminationWeeks(plan.eliminationWeeks)[0]!

  it('counts earlier non-revote councils that week and reads the planned total from the saved plan', async () => {
    db.survivorTribalCouncil.count.mockResolvedValue(2)
    const position = await loadCouncilWeekPosition('league', { week: doubleWeek, councilNumber: 3 }, { survivor_full_season_plan: plan }, db as never)
    expect(position).toEqual({ ordinal: 2, planned: 2 })
    expect(db.survivorTribalCouncil.count.mock.calls[0][0]).toEqual({
      where: { leagueId: 'league', week: doubleWeek, councilNumber: { lte: 3 }, NOT: { phase: 'revote' } },
    })
  })

  it('reports no planned votes for a league without a saved plan', async () => {
    db.survivorTribalCouncil.count.mockResolvedValue(1)
    expect(await loadCouncilWeekPosition('league', { week: 4, councilNumber: 1 }, {}, db as never)).toEqual({ ordinal: 1, planned: 0 })
  })
})
