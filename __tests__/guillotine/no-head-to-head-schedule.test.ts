import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A guillotine league has no opponents — every survivor plays the chop line. A round-robin
 * schedule would pair survivors with chopped, emptied teams, and those matchups could never go
 * final, so the week finalizer would retry them forever.
 */

const db = vi.hoisted(() => ({
  redraftMatchup: { count: vi.fn(), createMany: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
}))
const m = vi.hoisted(() => ({ isGuillotineLeague: vi.fn(), generateSchedule: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ isGuillotineLeague: m.isGuillotineLeague }))
vi.mock('@/lib/redraft/scheduleEngine', () => ({ generateSchedule: m.generateSchedule }))

import { ensureScheduleForNewSeason } from '@/lib/redraft/finalizeDraftToRedraftSeason'

const params = { seasonId: 's1', leagueId: 'L1', sport: 'NFL', totalWeeks: 17, playoffStartWeek: 15, medianGame: false }

beforeEach(() => {
  vi.clearAllMocks()
  db.redraftMatchup.count.mockResolvedValue(0)
  db.redraftRoster.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
  m.generateSchedule.mockReturnValue([{ week: 1, home: 'a', away: 'b', type: 'regular' }])
  db.redraftMatchup.createMany.mockResolvedValue({ count: 1 })
})

describe('ensureScheduleForNewSeason', () => {
  it('writes no head-to-head schedule for a guillotine league', async () => {
    m.isGuillotineLeague.mockResolvedValue(true)
    await ensureScheduleForNewSeason(params)
    expect(db.redraftMatchup.createMany).not.toHaveBeenCalled()
    expect(m.generateSchedule).not.toHaveBeenCalled()
  })

  it('still schedules every other league', async () => {
    m.isGuillotineLeague.mockResolvedValue(false)
    await ensureScheduleForNewSeason(params)
    expect(db.redraftMatchup.createMany).toHaveBeenCalledTimes(1)
  })

  it('schedules as before when the guillotine check itself fails', async () => {
    m.isGuillotineLeague.mockRejectedValue(new Error('db blip'))
    await ensureScheduleForNewSeason(params)
    expect(db.redraftMatchup.createMany).toHaveBeenCalledTimes(1)
  })
})
