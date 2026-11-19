/**
 * The scoring engine leaves a game the commissioner closed by hand exactly as it stands. Without that
 * the next score sync would rewrite its status to 'active' from the players' own finalized flags.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { findFirst: vi.fn() },
  redraftMatchup: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(async () => ({})) },
  redraftSeason: { findFirst: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn(async () => []) },
  playerWeeklyScore: { findUnique: vi.fn(async () => null) },
  roster: { findMany: vi.fn(async () => []) },
  afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
  leaguePlayerWeeklyScore: { deleteMany: vi.fn(async () => ({ count: 0 })), upsert: vi.fn() },
  $transaction: vi.fn(async (run: any) => (typeof run === 'function' ? run(db) : run)),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({ leagueUsesDevyEngine: vi.fn(async () => false), calculateOfficialTeamScore: vi.fn() }))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import { updateMatchupScores } from '@/lib/redraft/scoringEngine'

const MATCHUP = {
  id: 'm1', leagueId: 'L', seasonId: 's1', week: 4, homeRosterId: 'home', awayRosterId: 'away', homeScore: 101.5, awayScore: 88,
  status: 'final', lineupSnapshots: {}, homeRoster: { id: 'home', players: [] }, awayRoster: { id: 'away', players: [] }, league: { leagueVariant: null },
}
const league = (settings: Record<string, unknown>) => ({ settings, platform: 'manual', sport: 'NFL', leagueVariant: null, leagueType: 'redraft' })
const CLOSED = { commissioner_final_matchups: [{ matchupId: 'm1', week: 4, homeScore: 101.5, awayScore: 88, reason: 'ruling', byUserId: 'c', at: 't' }] }

beforeEach(() => {
  vi.clearAllMocks()
  db.redraftMatchup.findFirst.mockResolvedValue(MATCHUP)
  db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, sport: 'NFL', leagueId: 'L' })
})

describe('a game closed by hand', () => {
  it('is not rescored: nothing is written, and it reports the score it closed at', async () => {
    db.league.findFirst.mockResolvedValue(league(CLOSED))
    expect(await updateMatchupScores('m1')).toEqual({ matchupId: 'm1', week: 4, homeScore: 101.5, awayScore: 88, isComplete: true, missingPlayerIds: [] })
    expect(db.redraftMatchup.update).not.toHaveBeenCalled()
    expect(db.redraftRosterPlayer.findMany).not.toHaveBeenCalled()
  })

  it('[control] the same game with nothing on the list is rescored, and goes back to active', async () => {
    db.league.findFirst.mockResolvedValue(league({}))
    await updateMatchupScores('m1')
    expect(db.redraftMatchup.update).toHaveBeenCalledTimes(1)
    expect((db.redraftMatchup.update.mock.calls[0] as any)[0].data.status).toBe('active')
  })

  it('a different game on the list does not shield this one', async () => {
    db.league.findFirst.mockResolvedValue(league({ commissioner_final_matchups: [{ ...CLOSED.commissioner_final_matchups[0], matchupId: 'other' }] }))
    await updateMatchupScores('m1')
    expect(db.redraftMatchup.update).toHaveBeenCalledTimes(1)
  })
})
