/**
 * A commish stat correction is this league's only (lib/redraft/leagueStatOverrides.ts). The shared
 * PlayerWeeklyScore row stays the provider's; the league's matchup scores the corrected line, and a
 * league WITHOUT the correction still scores the shared row. The matchup snapshot keeps each player's
 * points, which is what a later official-correction check compares against.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readStatOverrides, withStatOverride } from '@/lib/redraft/leagueStatOverrides'

const db = vi.hoisted(() => ({
  league: { findFirst: vi.fn() },
  redraftMatchup: { findFirst: vi.fn(), update: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn() },
  roster: { findMany: vi.fn(async () => []) },
  afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({ leagueUsesDevyEngine: vi.fn(async () => false), calculateOfficialTeamScore: vi.fn() }))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import { calculateScoreFromSportConfig, updateMatchupScores } from '@/lib/redraft/scoringEngine'

const BASE_SETTINGS = { sportConfig: { scoringPreset: 'PPR' } }
const PLAYERS = { home: [{ playerId: 'w1', position: 'WR', slotType: 'WR' }], away: [{ playerId: 'r1', position: 'RB', slotType: 'RB' }] }
const SHARED = { w1: { rec_yds: 50 }, r1: { rush_yds: 80 } } as Record<string, Record<string, number>>

function arrange(settings: Record<string, unknown>) {
  db.league.findFirst.mockResolvedValue({ sport: 'NFL', settings, bestBallMode: false, leagueType: 'redraft', leagueVariant: null })
  db.redraftMatchup.findFirst.mockResolvedValue({ id: 'm1', leagueId: 'L1', seasonId: 's1', week: 5, homeRosterId: 'home', awayRosterId: 'away', homeRoster: {}, homeScore: 0, awayScore: 0 })
  db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, sport: 'NFL' })
  db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: { where: { rosterId: 'home' | 'away' } }) =>
    PLAYERS[where.rosterId].map((p) => ({ ...p, rosterId: where.rosterId, sport: 'NFL', playerName: p.playerId, droppedAt: null })),
  )
  db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }: { where: { playerId_week_season_sport: { playerId: string } } }) => ({
    stats: SHARED[where.playerId_week_season_sport.playerId],
    isFinalized: true,
  }))
  db.redraftMatchup.update.mockResolvedValue({})
}

beforeEach(() => vi.clearAllMocks())

describe('league stat overrides', () => {
  it('round-trips through settings without touching other keys or weeks', () => {
    let s: Record<string, unknown> = { keep: 1 }
    s = withStatOverride(s, { season: 2026, week: 5, playerId: 'w1', entry: { stats: { rec_yds: 90, junk: 'x' as never }, final: true, by: 'u', at: 't', reason: 'r' } })
    s = withStatOverride(s, { season: 2026, week: 6, playerId: 'w1', entry: { stats: { rec_yds: 10 }, final: true, by: 'u', at: 't', reason: null } })
    expect(s.keep).toBe(1)
    expect(readStatOverrides(s, 2026, 5).get('w1')).toMatchObject({ stats: { rec_yds: 90 }, final: true, reason: 'r' })
    expect(readStatOverrides(s, 2026, 6).get('w1')!.stats).toEqual({ rec_yds: 10 })
    expect(readStatOverrides(s, 2026, 7).size).toBe(0)
    expect(readStatOverrides({ stat_overrides: 'garbage' }, 2026, 5).size).toBe(0)
  })

  it('the league with the correction scores it; the shared row is not read for that player', async () => {
    const settings = withStatOverride(BASE_SETTINGS, { season: 2026, week: 5, playerId: 'w1', entry: { stats: { rec_yds: 90 }, final: true, by: 'u', at: 't', reason: null } })
    arrange(settings)
    const expected = await calculateScoreFromSportConfig('L1', 'w1', 5, { rec_yds: 90 }, 'WR')

    const summary = await updateMatchupScores('m1')

    expect(summary?.homeScore).toBe(Math.round(expected * 100) / 100)
    const reads = db.playerWeeklyScore.findUnique.mock.calls.map(([a]) => (a as any).where.playerId_week_season_sport.playerId)
    expect(reads).toEqual(['r1'])
    const snap = db.redraftMatchup.update.mock.calls[0]![0].data.lineupSnapshots.redraftScoring
    expect(snap.home.players).toEqual([{ playerId: 'w1', points: Math.round(expected * 100) / 100 }])
    expect(db.redraftMatchup.update.mock.calls[0]![0].data.status).toBe('final')
  })

  it('a league without the correction still scores the shared row', async () => {
    arrange(BASE_SETTINGS)
    const shared = await calculateScoreFromSportConfig('L1', 'w1', 5, SHARED.w1!, 'WR')
    const summary = await updateMatchupScores('m1')
    expect(summary?.homeScore).toBe(Math.round(shared * 100) / 100)
  })
})
