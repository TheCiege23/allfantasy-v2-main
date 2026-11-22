/**
 * True Max PF for leagues that play on AllFantasy (lib/rookie-order/nativeMaxPf.ts, loadNativeMaxPf.ts):
 * each team's best possible lineup in each finished regular-season week, scored by the league's rules,
 * from the lineup the team saved for that week — and the rookie order then ranks by it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({
  redraftMatchup: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  afRosterLineupAssignment: { findMany: vi.fn() },
  playerWeeklyScore: { findMany: vi.fn() },
  devyLeague: { findUnique: vi.fn(async () => null) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
// One QB and one RB seat; a stat line's `pts` is its fantasy points. The real optimiser decides who starts.
vi.mock('@/lib/redraft/scoringEngine', () => ({
  leagueIsBestBall: (l: { bestBallMode?: boolean | null }) => l.bestBallMode === true,
  buildBestBallSlots: () => [
    { slot: 'QB', eligible: ['QB'], count: 1 },
    { slot: 'RB', eligible: ['RB'], count: 1 },
  ],
  buildLeagueStatScorer: () => (stats: Record<string, number>) => stats.pts ?? 0,
}))

import { nativeMaxPfNote, nativeSeasonMaxPf, rosterForWeek } from '@/lib/rookie-order/nativeMaxPf'
import { loadNativeMaxPf } from '@/lib/rookie-order/loadNativeMaxPf'

const SLOTS = [
  { slot: 'QB', eligible: ['QB'], count: 1 },
  { slot: 'RB', eligible: ['RB'], count: 1 },
]
const POS: Record<string, string> = { qb1: 'QB', qb2: 'QB', rbStar: 'RB', rbScrub: 'RB', qbB: 'QB', rbB: 'RB' }

describe('the computation', () => {
  it('benching your best player does not lower Max PF', () => {
    const pts: Record<string, number> = { qb1: 20, rbStar: 30, rbScrub: 2 }
    const r = nativeSeasonMaxPf({
      weeks: [1],
      teams: [{ teamId: 'T', saved: [{ week: 1, playerIds: ['qb1', 'rbScrub', 'rbStar'] }], current: [] }],
      positionOf: (id) => POS[id] ?? null,
      pointsOf: (id) => pts[id] ?? null,
      slots: SLOTS,
    })
    // QB 20 + the star RB 30, whoever the manager actually started.
    expect(r.maxPfByTeam.get('T')).toBe(50)
  })

  it('a week with no saved lineup uses the latest earlier one; no save at all uses the current roster', () => {
    const team = { teamId: 'T', saved: [{ week: 2, playerIds: ['a'] }, { week: 4, playerIds: ['b'] }], current: ['now'] }
    expect(rosterForWeek(team, 4)).toEqual({ playerIds: ['b'], source: 'saved' })
    expect(rosterForWeek(team, 3)).toEqual({ playerIds: ['a'], source: 'carried' })
    expect(rosterForWeek(team, 1)).toEqual({ playerIds: ['now'], source: 'current' })
    const r = nativeSeasonMaxPf({ weeks: [1, 2, 3], teams: [team], positionOf: () => 'QB', pointsOf: () => 1, slots: SLOTS })
    expect(r).toMatchObject({ carried: 1, fromCurrent: 1, weeks: [1, 2, 3] })
    expect(nativeMaxPfNote(r)).toMatch(/3 finished regular-season weeks.*2 team-weeks have no lineup saved/)
  })

  it('a player with no stat line scored nothing; a team with nobody scores 0', () => {
    const r = nativeSeasonMaxPf({
      weeks: [1],
      teams: [{ teamId: 'A', saved: [{ week: 1, playerIds: ['qb1'] }], current: [] }, { teamId: 'B', saved: [], current: [] }],
      positionOf: (id) => POS[id] ?? null,
      pointsOf: () => null,
      slots: SLOTS,
    })
    expect(r.maxPfByTeam.get('A')).toBe(0)
    expect(r.maxPfByTeam.get('B')).toBe(0)
  })
})

describe('the read', () => {
  const league = { sport: 'NFL', settings: {}, leagueVariant: 'dynasty', leagueType: 'dynasty', bestBallMode: false }
  const args = { leagueId: 'L', league, seasonId: 'S', season: 2026, playoffStartWeek: 15, teamIds: ['rA', 'rB'] }

  beforeEach(() => {
    vi.clearAllMocks()
    db.redraftMatchup.findMany.mockResolvedValue([
      { week: 1, status: 'final' },
      { week: 1, status: 'final' },
      { week: 2, status: 'final' },
      { week: 2, status: 'in_progress' },
    ])
    db.roster.findMany.mockResolvedValue([{ id: 'afA', redraftRosterId: 'rA' }, { id: 'afB', redraftRosterId: 'rB' }])
    db.redraftRosterPlayer.findMany.mockResolvedValue([
      { rosterId: 'rA', playerId: 'qb1', position: 'QB', sport: 'NFL', slotType: 'starter', droppedAt: null },
      { rosterId: 'rA', playerId: 'rbScrub', position: 'RB', sport: 'NFL', slotType: 'starter', droppedAt: null },
      // Released since week 1, still in week 1's saved lineup.
      { rosterId: 'rA', playerId: 'rbStar', position: 'RB', sport: 'NFL', slotType: 'bench', droppedAt: new Date() },
      { rosterId: 'rB', playerId: 'qbB', position: 'QB', sport: 'NFL', slotType: 'starter', droppedAt: null },
      { rosterId: 'rB', playerId: 'rbB', position: 'RB', sport: 'NFL', slotType: 'ir', droppedAt: null },
    ])
    db.afRosterLineupAssignment.findMany.mockResolvedValue([
      { rosterId: 'afA', week: 1, playerId: 'qb1' },
      { rosterId: 'afA', week: 1, playerId: 'rbScrub' },
      { rosterId: 'afA', week: 1, playerId: 'rbStar' },
    ])
    db.playerWeeklyScore.findMany.mockResolvedValue([
      { playerId: 'qb1', week: 1, sport: 'NFL', stats: { pts: 20 } },
      { playerId: 'rbStar', week: 1, sport: 'NFL', stats: { pts: 30 } },
      { playerId: 'rbScrub', week: 1, sport: 'NFL', stats: { pts: 2 } },
      { playerId: 'qbB', week: 1, sport: 'NFL', stats: { pts: 15 } },
      { playerId: 'rbB', week: 1, sport: 'NFL', stats: { pts: 40 } },
    ])
  })

  it('only finished weeks, from the saved lineup; a team with no save uses its current non-IR roster', async () => {
    const r = await loadNativeMaxPf(args)
    expect(r.kind).toBe('computed')
    if (r.kind !== 'computed') return
    expect(r.result.weeks).toEqual([1]) // week 2 has a game still in progress
    expect(r.result.maxPfByTeam.get('rA')).toBe(50) // the released star still counts for week 1
    expect(r.result.maxPfByTeam.get('rB')).toBe(15) // the IR back can never start
    expect(r.result.fromCurrent).toBe(1)
    // Only starters and bench rows of the saved lineup are read.
    expect(db.afRosterLineupAssignment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ section: { in: ['starters', 'bench'] } }) }))
  })

  it('best ball: Max PF is points for; daily lineups and devy are not computed', async () => {
    expect(await loadNativeMaxPf({ ...args, league: { ...league, bestBallMode: true } })).toEqual({ kind: 'best_ball' })
    expect(await loadNativeMaxPf({ ...args, league: { ...league, sport: 'NBA', settings: { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } } } })).toEqual({ kind: 'unsupported', reason: 'daily_lineups' })
    db.devyLeague.findUnique.mockResolvedValueOnce({ id: 'd' } as never)
    expect(await loadNativeMaxPf(args)).toEqual({ kind: 'unsupported', reason: 'devy_engine' })
  })

  it('no finished week: not computed', async () => {
    db.redraftMatchup.findMany.mockResolvedValue([{ week: 1, status: 'scheduled' }])
    expect(await loadNativeMaxPf(args)).toEqual({ kind: 'unsupported', reason: 'no_finished_week' })
  })
})

describe('the rookie order ranks a native league by it', () => {
  it('a team that benched its stars no longer earns pick 1 by scoring less', async () => {
    vi.resetModules()
    const lo = vi.hoisted(() => ({
      league: { findUnique: vi.fn() },
      redraftSeason: { findFirst: vi.fn() },
      redraftRoster: { findMany: vi.fn() },
      redraftPlayoffSeed: { findMany: vi.fn() },
      redraftPlayoffRound: { findMany: vi.fn() },
      roster: { findMany: vi.fn() },
    }))
    vi.doMock('@/lib/prisma', () => ({ prisma: lo }))
    // Points for: Tank 900 (benched its stars all year), Weak 1000, then two playoff teams.
    // Max PF: Tank 1500 — it had the roster to win; Weak 1050 — it did not.
    vi.doMock('@/lib/rookie-order/loadNativeMaxPf', () => ({
      loadNativeMaxPf: async () => ({
        kind: 'computed',
        result: { maxPfByTeam: new Map([['tank', 1500], ['weak', 1050], ['p1', 1400], ['p2', 1300]]), weeks: [1, 2, 3], carried: 0, fromCurrent: 0 },
      }),
    }))
    lo.league.findUnique.mockResolvedValue({ id: 'L', season: 2026, platform: 'allfantasy', platformLeagueId: 'L', playoffStartWeek: 15, settings: {}, sport: 'NFL', leagueVariant: 'dynasty', leagueType: 'dynasty', isDynasty: true, bestBallMode: false })
    lo.redraftSeason.findFirst.mockResolvedValue({ id: 'S', season: 2026, currentWeek: 15, playoffStartWeek: 15, status: 'playoffs', playoffBracket: null })
    lo.redraftRoster.findMany.mockResolvedValue([
      { id: 'tank', teamName: 'Tank', ownerName: 't', wins: 3, losses: 11, ties: 0, pointsFor: 900, playoffSeed: null },
      { id: 'weak', teamName: 'Weak', ownerName: 'w', wins: 4, losses: 10, ties: 0, pointsFor: 1000, playoffSeed: null },
      { id: 'p1', teamName: 'P1', ownerName: 'a', wins: 11, losses: 3, ties: 0, pointsFor: 1300, playoffSeed: 1 },
      { id: 'p2', teamName: 'P2', ownerName: 'b', wins: 10, losses: 4, ties: 0, pointsFor: 1250, playoffSeed: 2 },
    ])
    lo.redraftPlayoffSeed.findMany.mockResolvedValue([{ rosterId: 'p1', seed: 1 }, { rosterId: 'p2', seed: 2 }])
    lo.redraftPlayoffRound.findMany.mockResolvedValue([])
    lo.roster.findMany.mockResolvedValue([])

    const { loadRookieOrderInput } = await import('@/lib/rookie-order/loadRookieOrderInput')
    const { computeRookieOrder } = await import('@/lib/rookie-order/rookieOrderEngine')
    const loaded = await loadRookieOrderInput('L')
    expect(loaded!.notes[0]).toMatch(/^Max PF is each team's best possible lineup in each of the 3 finished/)
    const res = computeRookieOrder({ ...loaded!.input, config: { nonPlayoff: 'reverse_max_pf' } })
    expect(res.maxPfSource).toBe('max_pf')
    expect(res.slots.slice(0, 2).map((s) => s.teamId)).toEqual(['weak', 'tank'])
    // By points for, the tanker would have had 1.01.
    const byPf = computeRookieOrder({ ...loaded!.input, teams: loaded!.input.teams.map((t) => ({ ...t, maxPf: null })), config: { nonPlayoff: 'reverse_max_pf' } })
    expect(byPf.maxPfSource).toBe('points_for')
    expect(byPf.slots[0].teamId).toBe('tank')
  })
})
