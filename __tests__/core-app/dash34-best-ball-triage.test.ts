// @vitest-environment node
/**
 * Best ball leagues in the home's "Starters in doubt" (founder-reported 2026-10-08).
 *
 * 🛑 Sleeper fills `starters` in a best ball league with the platform's auto lineup, and the injury
 * book counted those as "starting" — so a best ball league put players in "Starters in doubt" that
 * nobody can bench. The flag here is the one production imports actually carry (`settings.best_ball`),
 * not the `bestBallMode` column, which 0 of 344 imported leagues had set.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))
vi.mock('@/lib/injuries/injurySyncState', () => ({ readInjurySyncFreshness: async () => null }))
vi.mock('@/lib/player-values/latestPlayerValueSnapshots', () => ({
  loadLatestPlayerValueSnapshots: vi.fn(async () => []),
}))

const { db, rows } = vi.hoisted(() => ({
  db: { settings: { best_ball: 1, roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN', 'BN'] } as Record<string, unknown> },
  rows: (list: unknown[]) => ({ findMany: vi.fn(async () => list) }),
}))

const PLAYERS = [
  { sleeperId: '1001', name: 'Healthy Quarterback', position: 'QB', team: 'KC', sport: 'NFL', imageUrl: null },
  { sleeperId: '1002', name: 'Hurt Quarterback', position: 'QB', team: 'BUF', sport: 'NFL', imageUrl: null },
  { sleeperId: '1003', name: 'Iffy Quarterback', position: 'QB', team: 'CIN', sport: 'NFL', imageUrl: null },
]

vi.mock('@/lib/prisma', () => ({
  prisma: {
    guillotineRosterState: rows([]),
    guillotineElimination: rows([]),
    leagueTeam: rows([
      { leagueId: 'L1', id: 'T1', teamName: 'Mine', ownerName: 'me', platformUserId: 'p1', externalId: '1', isCommissioner: false, isCoCommissioner: false },
    ]),
    sportsGame: rows([]),
    // The auto lineup started the hurt QB.
    roster: rows([{ id: 'R1', leagueId: 'L1', playerData: { players: ['1001', '1002', '1003'], starters: ['1002'] } }]),
    sportsPlayer: { findMany: vi.fn(async () => PLAYERS) },
    sportsInjury: rows([
      { playerName: 'Hurt Quarterback', status: 'Out', description: 'Ankle', date: new Date(), position: 'QB', team: 'BUF' },
      { playerName: 'Iffy Quarterback', status: 'Questionable', description: 'Knee', date: new Date(), position: 'QB', team: 'CIN' },
    ]),
    league: { findMany: vi.fn(async () => [{ id: 'L1', platform: 'sleeper', guillotineMode: false, settings: db.settings }]) },
    weeklyMatchup: rows([]),
  },
}))

import { getDash34Data } from '@/lib/core-app/dash34'

const LEAGUE = { id: 'L1', name: 'Best Ball League', sport: 'NFL', status: 'in_season', hasUnifiedRecord: true, lastSyncedAt: null }
type Row = { name: string; startingIn: number; bestBallIn?: number }

beforeEach(() => {
  vi.clearAllMocks()
  db.settings = { best_ball: 1, roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN', 'BN'] }
})

describe('getDash34Data — best ball has no starters in doubt', () => {
  it('🛑 an auto-lineup "starter" in best ball is not starting, and the thin QB room is flagged', { timeout: 60_000 }, async () => {
    const result = await getDash34Data('u1', [LEAGUE], new Date())
    const hurt = ((result.book ?? []) as unknown as Row[]).find((r) => r.name === 'Hurt Quarterback')
    expect(hurt).toBeDefined()
    expect(hurt!.startingIn).toBe(0)
    expect(hurt!.bestBallIn).toBe(1)
    expect(result.depthAlerts).toEqual([
      expect.objectContaining({ leagueId: 'L1', position: 'QB', rostered: 3, healthy: 1, out: 1, questionable: 1 }),
    ])
  })

  it('CONTROL: the same roster in a lineup league IS a starter in doubt, with no depth check', { timeout: 60_000 }, async () => {
    db.settings = { roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'BN', 'BN'] }
    const result = await getDash34Data('u1', [LEAGUE], new Date())
    const hurt = ((result.book ?? []) as unknown as Row[]).find((r) => r.name === 'Hurt Quarterback')
    expect(hurt!.startingIn).toBe(1)
    expect(result.depthAlerts ?? []).toEqual([])
  })
})
