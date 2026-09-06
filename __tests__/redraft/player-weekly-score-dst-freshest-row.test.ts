import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 🛑 A DEF/DST'S POINTS-ALLOWED CAME FROM WHICHEVER `SportsGame` ROW `findMany`
 * HAPPENED TO RETURN LAST FOR THAT TEAM.
 *
 * A single real-world fixture carries 3-4 `SportsGame` rows in this table, one
 * per provider feed (per-source uniqueness is the actual DB constraint:
 * `@@unique([sport, externalId, source])`). `lib/live/liveScoresPage.ts`
 * already hit this and fixed it with `pickFreshestSourceRows` — trust one
 * source for the whole batch rather than blending or picking arbitrarily.
 * `playerWeeklyScoreService.ts`'s team-defense points-allowed derivation built
 * `gameByTeam` from an unordered, undeduped `findMany`, so a stale or
 * still-scoreless duplicate row from a different source could silently win
 * over the one with the real final score.
 *
 * This pins the fix: given a stale (>6h old, "dead") row with the wrong score
 * and a fresh row with the correct score for the same fixture, the DEF's
 * `def_points_allowed` must come from the fresh row.
 */

const {
  findFirstRedraftSeason,
  findManyRedraftRoster,
  findManyRedraftRosterPlayer,
  findManyPlayerGameLogCache,
  findManySportsGame,
  upsertPlayerWeeklyScore,
  calculateScoreFromSportConfig,
} = vi.hoisted(() => ({
  findFirstRedraftSeason: vi.fn(),
  findManyRedraftRoster: vi.fn(),
  findManyRedraftRosterPlayer: vi.fn(),
  findManyPlayerGameLogCache: vi.fn(),
  findManySportsGame: vi.fn(),
  upsertPlayerWeeklyScore: vi.fn(),
  calculateScoreFromSportConfig: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: findFirstRedraftSeason },
    redraftRoster: { findMany: findManyRedraftRoster },
    redraftRosterPlayer: { findMany: findManyRedraftRosterPlayer },
    playerGameLogCache: { findMany: findManyPlayerGameLogCache },
    sportsGame: { findMany: findManySportsGame },
    playerWeeklyScore: { upsert: upsertPlayerWeeklyScore },
  },
}))

vi.mock('@/lib/redraft/scoringEngine', () => ({
  calculateScoreFromSportConfig,
}))

import { syncPlayerWeeklyScoresForRedraftSeason } from '@/lib/redraft/playerWeeklyScoreService'

beforeEach(() => {
  vi.clearAllMocks()
  findFirstRedraftSeason.mockResolvedValue({
    id: 'season-1',
    leagueId: 'league-1',
    currentWeek: 1,
    sport: 'NFL',
    season: 2026,
  })
  findManyRedraftRoster.mockResolvedValue([{ id: 'roster-1' }])
  findManyRedraftRosterPlayer.mockResolvedValue([
    { playerId: 'nfl:def:KC', sport: 'NFL', position: 'DEF', team: 'KC' },
  ])
  findManyPlayerGameLogCache.mockResolvedValue([])
  calculateScoreFromSportConfig.mockResolvedValue(2.5)
})

describe('syncPlayerWeeklyScoresForRedraftSeason — DST points-allowed freshest-row dedup', () => {
  it('derives def_points_allowed from the fresh source, not a stale duplicate row', async () => {
    // Fresh row FIRST, stale row SECOND — a naive last-write-wins loop over
    // an unordered `findMany` result would let the stale row overwrite the
    // fresh one for team KC. Ordering it this way is what makes the test
    // actually discriminate the fix from the bug, rather than passing by
    // accident of array order.
    findManySportsGame.mockResolvedValueOnce([
      {
        homeTeam: 'KC',
        awayTeam: 'DEN',
        homeScore: 27,
        awayScore: 20, // correct, current score
        source: 'new_provider',
        fetchedAt: new Date(), // fresh
      },
      {
        homeTeam: 'KC',
        awayTeam: 'DEN',
        homeScore: 10,
        awayScore: 3, // wrong/stale score for the away team (DEN)
        source: 'old_provider',
        fetchedAt: new Date(Date.now() - 7 * 60 * 60 * 1000), // 7h old — dead
      },
    ])

    await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: 'season-1' })

    expect(upsertPlayerWeeklyScore).toHaveBeenCalledTimes(1)
    const call = upsertPlayerWeeklyScore.mock.calls[0]![0] as { update: { stats: Record<string, number> } }
    // KC is home in both rows; points allowed to KC's defense = the opponent's
    // (away) score. The fresh row's away score (20) must win over the stale
    // row's (3).
    expect(call.update.stats.def_points_allowed).toBe(20)
  })

  it('still works with only one SportsGame row (no dedup needed)', async () => {
    findManySportsGame.mockResolvedValueOnce([
      {
        homeTeam: 'KC',
        awayTeam: 'DEN',
        homeScore: 27,
        awayScore: 20,
        source: 'only_provider',
        fetchedAt: new Date(),
      },
    ])

    await syncPlayerWeeklyScoresForRedraftSeason({ seasonId: 'season-1' })

    const call = upsertPlayerWeeklyScore.mock.calls[0]![0] as { update: { stats: Record<string, number> } }
    expect(call.update.stats.def_points_allowed).toBe(20)
  })
})
