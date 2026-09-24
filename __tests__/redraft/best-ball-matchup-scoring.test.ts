import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A NATIVE BEST-BALL TEAM WAS SCORED ON ITS STALE STARTER SLOTS. The matchup summed only the
 * players the draft auto-slotted as starters; nothing ever re-slotted them, so bench points never
 * counted. These tests pin that the matchup now starts each team's optimal lineup from its whole
 * active roster, on the league's own slots (superflex included), and that a lineup league is
 * scored exactly as before.
 */

const db = vi.hoisted(() => ({
  league: { findFirst: vi.fn() },
  redraftMatchup: { findFirst: vi.fn(), update: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: vi.fn(async () => false),
  calculateOfficialTeamScore: vi.fn(),
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import {
  buildBestBallSlots,
  calculateScoreFromSportConfig,
  countsTowardScore,
  isBestBallCandidateSlot,
  leagueIsBestBall,
  updateMatchupScores,
} from '@/lib/redraft/scoringEngine'

const SUPERFLEX_SETTINGS = {
  sportConfig: { scoringPreset: 'PPR' },
  roster: { config: { sections: [{ slots: { QB: 1, RB: 1, WR: 1, SUPER_FLEX: 1, BN: 3, IR: 1 } }] } },
}

type P = { playerId: string; position: string; slotType: string; yards: number }
const HOME: P[] = [
  { playerId: 'q1', position: 'QB', slotType: 'QB', yards: 50 },
  { playerId: 'q2', position: 'QB', slotType: 'BENCH', yards: 250 },
  { playerId: 'r1', position: 'RB', slotType: 'RB', yards: 20 },
  { playerId: 'r2', position: 'RB', slotType: 'BN', yards: 150 },
  { playerId: 'w1', position: 'WR', slotType: 'WR', yards: 100 },
  // A huge week on IR must never count, best ball or not.
  { playerId: 'ir', position: 'WR', slotType: 'IR', yards: 400 },
]
const AWAY: P[] = [{ playerId: 'a1', position: 'WR', slotType: 'WR', yards: 30 }]

function arrange(league: Record<string, unknown>, opts: { missing?: string[] } = {}) {
  const all = [...HOME, ...AWAY]
  db.league.findFirst.mockResolvedValue({ sport: 'NFL', settings: SUPERFLEX_SETTINGS, ...league })
  db.redraftMatchup.findFirst.mockResolvedValue({
    id: 'm1',
    leagueId: 'L1',
    seasonId: 's1',
    week: 3,
    homeRosterId: 'home',
    awayRosterId: 'away',
    homeRoster: {},
    homeScore: 0,
    awayScore: 0,
  })
  db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, sport: 'NFL' })
  db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: { where: { rosterId: string } }) =>
    (where.rosterId === 'home' ? HOME : AWAY).map((p) => ({ ...p, sport: 'NFL', playerName: p.playerId, droppedAt: null })),
  )
  db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }: { where: { playerId_week_season_sport: { playerId: string } } }) => {
    const id = where.playerId_week_season_sport.playerId
    if (opts.missing?.includes(id)) return null
    const p = all.find((x) => x.playerId === id)!
    return { stats: { rush_yds: p.yards }, isFinalized: true }
  })
  db.redraftMatchup.update.mockResolvedValue({})
}

async function pts(id: string): Promise<number> {
  const p = [...HOME, ...AWAY].find((x) => x.playerId === id)!
  return calculateScoreFromSportConfig('L1', id, 3, { rush_yds: p.yards }, p.position)
}

beforeEach(() => vi.clearAllMocks())

describe('best-ball matchup scoring', () => {
  it('starts the optimal lineup from the whole roster — bench counts, superflex takes a second QB, IR does not', async () => {
    arrange({ bestBallMode: true, leagueType: 'best_ball', leagueVariant: null })
    // QB <- q2 (bench), RB <- r2 (bench), WR <- w1, SUPER_FLEX <- q1 (beats r1).
    const expected = Math.round(((await pts('q2')) + (await pts('r2')) + (await pts('w1')) + (await pts('q1'))) * 100) / 100
    expect(expected).toBeGreaterThan(0)

    const summary = await updateMatchupScores('m1')

    expect(summary?.homeScore).toBe(expected)
    const data = db.redraftMatchup.update.mock.calls[0]![0].data
    const assignments = data.lineupSnapshots.redraftScoring.home.bestBall.assignments as { slot: string; playerId: string }[]
    // Both QBs start; which of the two takes the QB seat and which the SF seat is a tie the total ignores.
    expect(assignments.map((a) => a.playerId).sort()).toEqual(['q1', 'q2', 'r2', 'w1'])
    expect(assignments.filter((a) => a.slot === 'QB' || a.slot === 'SF').map((a) => a.playerId).sort()).toEqual(['q1', 'q2'])
    expect(data.status).toBe('final')
  })

  it('a lineup league is scored on its starter slots exactly as before', async () => {
    arrange({ bestBallMode: false, leagueType: 'redraft', leagueVariant: null })
    const expected = Math.round(((await pts('q1')) + (await pts('r1')) + (await pts('w1'))) * 100) / 100

    const summary = await updateMatchupScores('m1')

    expect(summary?.homeScore).toBe(expected)
    expect(db.redraftMatchup.update.mock.calls[0]![0].data.lineupSnapshots.redraftScoring.home.bestBall).toBeUndefined()
  })

  it('stays open while any best-ball candidate, bench included, has no stat row yet', async () => {
    arrange({ bestBallMode: true, leagueType: 'best_ball', leagueVariant: null }, { missing: ['r2'] })

    const summary = await updateMatchupScores('m1')

    expect(summary?.isComplete).toBe(false)
    expect(summary?.missingPlayerIds).toEqual(['r2'])
    expect(db.redraftMatchup.update.mock.calls[0]![0].data.status).toBe('active')
  })
})

describe('best-ball helpers', () => {
  it('builds the league’s own slots, with superflex eligibility', () => {
    const slots = buildBestBallSlots('NFL', SUPERFLEX_SETTINGS)
    expect(slots.map((s) => `${s.slot}x${s.count}`)).toEqual(['QBx1', 'RBx1', 'WRx1', 'SFx1'])
    expect(slots.find((s) => s.slot === 'SF')!.eligible).toEqual(expect.arrayContaining(['QB', 'RB', 'WR', 'TE']))
  })

  it('counts the bench in best ball and never IR / reserve / taxi / devy', () => {
    expect(['BENCH', 'BN', 'QB', 'FLEX'].every(isBestBallCandidateSlot)).toBe(true)
    expect(['IR', 'RESERVE', 'TAXI', 'DEVY'].some(isBestBallCandidateSlot)).toBe(false)
    expect(countsTowardScore('BENCH', true)).toBe(true)
    expect(countsTowardScore('BENCH', false)).toBe(false)
  })

  it('recognises a best-ball league by flag, variant or type', () => {
    expect(leagueIsBestBall({ bestBallMode: true })).toBe(true)
    expect(leagueIsBestBall({ leagueType: 'best_ball' })).toBe(true)
    expect(leagueIsBestBall({ leagueVariant: 'bestball' })).toBe(true)
    expect(leagueIsBestBall({ leagueType: 'redraft', bestBallMode: false })).toBe(false)
    expect(leagueIsBestBall(null)).toBe(false)
  })
})
