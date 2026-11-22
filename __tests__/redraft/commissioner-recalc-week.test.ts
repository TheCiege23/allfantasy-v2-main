/**
 * The commissioner's "Recalculate week" on a league that plays on AllFantasy re-scores the league's own
 * games. It used to score a round-robin the league does not play, into tables its season never reads,
 * and then tell every member the week had been processed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { platform: 'manual' } as { platform: string } | null,
  season: { id: 'S', currentWeek: 3 } as { id: string; currentWeek: number } | null,
  games: [] as Array<{ status: string; awayRosterId: string | null }>,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => db.league) },
    redraftSeason: { findFirst: vi.fn(async () => db.season) },
    redraftMatchup: { findMany: vi.fn(async () => db.games) },
  },
}))

import { recalcNativeLeagueWeek } from '@/lib/redraft/commissionerRecalcWeek'

const recalc = vi.fn(async () => ({ updated: 6, incomplete: 1 }))
const updateStandings = vi.fn(async () => ({}))
const run = (week: number) => recalcNativeLeagueWeek({ leagueId: 'L', seasonYear: 2026, week }, { recalc, updateStandings })

beforeEach(() => {
  db.league = { platform: 'manual' }
  db.season = { id: 'S', currentWeek: 3 }
  db.games = [{ status: 'active', awayRosterId: 'b' }, { status: 'final', awayRosterId: 'd' }, { status: 'scheduled', awayRosterId: null }]
  recalc.mockClear()
  updateStandings.mockClear()
})

describe('recalcNativeLeagueWeek', () => {
  it('re-scores the league’s own games for a week in play, then refreshes the records', async () => {
    expect(await run(3)).toEqual({ kind: 'recalculated', week: 3, games: 6, incomplete: 1 })
    expect(recalc).toHaveBeenCalledWith('S', 3)
    expect(updateStandings).toHaveBeenCalledWith('S', 3)
  })

  it('🛑 records are refreshed through the league’s current week, never rolled back to an earlier one', async () => {
    await run(2)
    expect(recalc).toHaveBeenCalledWith('S', 2)
    expect(updateStandings).toHaveBeenCalledWith('S', 3)
  })

  it('🛑 a final week is left exactly as it stands', async () => {
    db.games = [{ status: 'final', awayRosterId: 'b' }, { status: 'final', awayRosterId: 'd' }, { status: 'scheduled', awayRosterId: null }]
    expect(await run(1)).toEqual({ kind: 'week_final', week: 1 })
    expect(recalc).not.toHaveBeenCalled()
    expect(updateStandings).not.toHaveBeenCalled()
  })

  it('a week the league has not reached is not scored, so its games are not marked as in play', async () => {
    db.games = [{ status: 'scheduled', awayRosterId: 'b' }]
    expect(await run(7)).toEqual({ kind: 'week_not_started', week: 7, currentWeek: 3 })
    expect(recalc).not.toHaveBeenCalled()
  })

  it('a season that has not started can still score week 1', async () => {
    db.season = { id: 'S', currentWeek: 0 }
    db.games = [{ status: 'scheduled', awayRosterId: 'b' }]
    expect((await run(1)).kind).toBe('recalculated')
    expect(updateStandings).toHaveBeenCalledWith('S', 1)
  })

  it('a week with no games says so', async () => {
    db.games = []
    expect(await run(3)).toEqual({ kind: 'no_games', week: 3 })
  })

  it('an imported league, or a league with no season, is left to the caller', async () => {
    db.league = { platform: 'sleeper' }
    expect(await run(3)).toEqual({ kind: 'not_native_season' })
    db.league = { platform: 'manual' }
    db.season = null
    expect(await run(3)).toEqual({ kind: 'not_native_season' })
    expect(recalc).not.toHaveBeenCalled()
  })
})
