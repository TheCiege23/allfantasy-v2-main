/**
 * Games limits and a "which games count" rule stored together (lib/redraft/scoringEngine.ts).
 *
 * The settings PATCH refuses the pair, but a league can still hold both (written before the guard, or
 * by hand). The limits step re-sums only the started days it was handed, and a player scored by the
 * games-count rule is never handed to it, so it used to replace the week's total and drop those points.
 * This pins that the games-count points survive the limits step.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { findFirst: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn() },
  playerDailyScore: { findMany: vi.fn() },
  redraftDailyLineup: { findMany: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
  afRosterLineupAssignment: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: vi.fn(async () => false),
  calculateOfficialTeamScore: vi.fn(),
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))
vi.mock('@/lib/redraft/gamesCountStore', () => ({
  loadGamesCountScoring: vi.fn(async () => ({
    setting: { mode: 'lock_in' },
    games: new Map([['p1', [{ gameId: 'g1', day: '2026-10-27', startTime: null, stats: { pts: 10 } }]]]),
    choices: new Map(),
  })),
  scoreCountedGames: vi.fn(async () => ({ points: 42, countedStats: [{ pts: 42 }] })),
}))

import { scoreRosterForWeek } from '@/lib/redraft/scoringEngine'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

beforeEach(() => {
  vi.clearAllMocks()
  db.league.findFirst.mockResolvedValue({
    sport: 'NBA',
    settings: {
      sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true, gamesCountMode: 'lock_in' },
      games_limits: { gamesPlayedCaps: { PG: 1 } },
    },
  })
  db.redraftRosterPlayer.findMany.mockResolvedValue([
    { playerId: 'p1', rosterId: 'r1', sport: 'NBA', position: 'PG', slotType: 'PG', playerName: 'p1', droppedAt: null, addedAt: day('2026-10-01') },
  ])
  db.roster.findMany.mockResolvedValue([])
  db.afRosterLineupAssignment.findMany.mockResolvedValue([])
  db.redraftDailyLineup.findMany.mockResolvedValue([])
  db.playerDailyScore.findMany.mockResolvedValue([
    { playerId: 'p1', scoringDay: day('2026-10-27'), stats: { pts: 10 }, gamesPlayed: 1, isFinalized: true },
  ])
  db.playerWeeklyScore.findUnique.mockResolvedValue({ stats: {}, isFinalized: true })
})

describe('games limits do not erase points the games-count rule decided', () => {
  it('the games-count total is kept through the limits step', async () => {
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 2, seasonYear: 2026 })
    expect(r.points).toBe(42)
    expect(r.statTotals).toMatchObject({ pts: 42 })
  })
})
