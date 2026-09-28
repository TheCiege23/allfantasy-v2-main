import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A lineup is ONE week's lineup. Measured on production 2026-09-28, the Monday of week 3: three
 * leagues raised a red "Listed Out in your starting lineup · kicks off Sun 1:00p ET · IN 6D" for
 * starters whose clubs had played on Sunday — a settled slot, paired with week 4's kickoff.
 */
const live = vi.hoisted(() => vi.fn())
const games = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }))
vi.mock('@/lib/core-app/currentSleeperRoster', () => ({ currentSleeperRoster: live }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/injuries/injurySyncState', () => ({ readInjurySyncFreshness: async () => null }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findMany: async () => [] },
  guillotineRosterState: { findMany: async () => [] },
  guillotineElimination: { findMany: async () => [] },
  leagueTeam: { findMany: async () => [{ leagueId: 'af-league', platformUserId: 'owner', externalId: '3', teamName: 'NFC Dreaming' }] },
  roster: { findMany: async () => [{ leagueId: 'af-league', playerData: { players: ['daniels', 'hurts'], starters: ['daniels'] } }] },
  sportsGame: { findMany: async () => games.rows },
  sportsPlayer: { findMany: async () => [
    { sleeperId: 'daniels', name: 'Jayden Daniels', position: 'QB', team: 'WAS', sport: 'NFL', imageUrl: null },
    { sleeperId: 'hurts', name: 'Jalen Hurts', position: 'QB', team: 'PHI', sport: 'NFL', imageUrl: null },
  ] },
  sportsInjury: { findMany: async () => [
    { playerName: 'Jayden Daniels', position: 'QB', team: 'WAS', status: 'Out', description: 'Hamstring', date: new Date('2026-09-27T12:00:00Z') },
    { playerName: 'Jalen Hurts', position: 'QB', team: 'PHI', status: 'Out', description: 'Knee', date: new Date('2026-09-27T12:00:00Z') },
  ] },
  playerValueSnapshot: { findMany: async () => [] },
} }))
import { getDash34Data } from '@/lib/core-app/dash34'
import { mergeDash34Issues } from '@/lib/core-app/mergeDash34Issues'

const leagues = [{ id: 'af-league', name: 'NFC Dreaming', platform: 'sleeper', platformLeagueId: 'sleeper-league', sport: 'NFL', status: 'in_season' }]
const MONDAY = new Date('2026-09-28T12:15:00Z')
const MNF = new Date('2026-09-29T00:15:00Z') // PHI at CHI, week 3
const WEEK4_SUNDAY = new Date('2026-10-04T17:00:00Z') // WAS and PHI both play in week 4

const fixture = (home: string, away: string, startTime: Date, week: number | null) => ({
  homeTeam: home, awayTeam: away, startTime, week, source: 'x', externalId: `${home}-${away}-${week}`,
})

function liveRoster(starters: string[]) {
  return {
    players: ['daniels', 'hurts'], starters, reserve: [], taxi: [],
    verification: { checkedAt: MONDAY.toISOString(), week: 3, source: 'Sleeper', slots: ['QB'] },
  }
}

describe('lineup alerts belong to the lineup week', () => {
  beforeEach(() => {
    live.mockReset()
    games.rows = [
      fixture('Chicago Bears', 'Philadelphia Eagles', MNF, 3),
      fixture('Washington Commanders', 'Dallas Cowboys', WEEK4_SUNDAY, 4),
      fixture('Philadelphia Eagles', 'New York Giants', WEEK4_SUNDAY, 4),
    ]
  })

  it("does not alert on a starter whose club already played this week's game", async () => {
    live.mockResolvedValue(liveRoster(['daniels']))
    const dashboard = await getDash34Data('user', leagues, MONDAY)
    expect(dashboard.allLeagues?.[0].hurtStarters).toBe(0)
    expect(dashboard.allLeagues?.[0].flaggedStarters).toEqual([])
    expect(mergeDash34Issues([], dashboard).some((i) => i.id.endsWith(':starter-out'))).toBe(false)
  })

  it('still alerts on a starter whose club plays later THIS week, with that game as the deadline', async () => {
    live.mockResolvedValue(liveRoster(['hurts']))
    const dashboard = await getDash34Data('user', leagues, MONDAY)
    expect(dashboard.allLeagues?.[0].hurtStarters).toBe(1)
    expect(dashboard.allLeagues?.[0].hurtStarterKickoffAt).toBe(MNF.toISOString())
    const row = mergeDash34Issues([], dashboard).find((i) => i.id.endsWith(':starter-out'))
    expect(row?.deadline?.toISOString()).toBe(MNF.toISOString())
  })

  it('keeps the old behaviour when no fixture carries a week number (a data gap, not a finished week)', async () => {
    games.rows = games.rows.map((g) => ({ ...g, week: null }))
    live.mockResolvedValue(liveRoster(['daniels']))
    const dashboard = await getDash34Data('user', leagues, MONDAY)
    expect(dashboard.allLeagues?.[0].hurtStarters).toBe(1)
  })
})
