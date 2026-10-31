import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The C2C campus points (lib/c2c/campusScoring.ts) are added to each team's pro score in the one
 * matchup scorer the live sync and the week seal both run — and to a bye team's median score.
 */

const { db, campusPointsForMatchup, nbaCampusPointsForMatchup } = vi.hoisted(() => ({
  db: {
    league: { findFirst: vi.fn() },
    redraftMatchup: { findFirst: vi.fn(), update: vi.fn() },
    redraftSeason: { findFirst: vi.fn() },
    redraftRosterPlayer: { findMany: vi.fn() },
    playerWeeklyScore: { findUnique: vi.fn() },
    roster: { findMany: vi.fn() },
    afRosterLineupAssignment: { findMany: vi.fn() },
  },
  campusPointsForMatchup: vi.fn(),
  nbaCampusPointsForMatchup: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/c2c/campusScoring', async () => ({
  campusPointsForMatchup,
  campusSport: (await vi.importActual<typeof import('@/lib/c2c/campusLineup')>('@/lib/c2c/campusLineup')).campusSport,
}))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', () => ({ getC2CConfig: vi.fn(async () => ({ collegeScoringSystem: 'points', bestBallCollege: false, standingsModel: 'unified' })) }))
vi.mock('@/lib/c2c/nbaCampusMatchupScoring', () => ({ nbaCampusPointsForMatchup }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({ leagueUsesDevyEngine: vi.fn(async () => false), calculateOfficialTeamScore: vi.fn() }))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import { scoreRosterForWeek, updateMatchupScores } from '@/lib/redraft/scoringEngine'

const CAMPUS = {
  cfbWeeks: [2],
  home: { points: 21.5, players: [{ playerId: 'c1', points: 21.5 }] },
  away: { points: 0, players: [] },
}

beforeEach(() => {
  vi.clearAllMocks()
  db.redraftMatchup.update.mockResolvedValue({})
  db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, sport: 'NFL', medianGame: true })
  db.roster.findMany.mockResolvedValue([])
  db.afRosterLineupAssignment.findMany.mockResolvedValue([])
  db.redraftRosterPlayer.findMany.mockImplementation(async ({ where }: { where: { rosterId: string } }) => [
    { playerId: `${where.rosterId}-wr`, position: 'WR', slotType: 'WR', rosterId: where.rosterId, sport: 'NFL', playerName: 'w', droppedAt: null },
  ])
  db.playerWeeklyScore.findUnique.mockResolvedValue({ stats: { rec_yds: 100 }, isFinalized: true })
  db.redraftMatchup.findFirst.mockResolvedValue({
    id: 'm1', leagueId: 'L1', seasonId: 's1', week: 3, homeRosterId: 'H', awayRosterId: 'A',
    homeRoster: {}, awayRoster: {}, homeScore: 0, awayScore: 0, lineupSnapshots: null,
  })
  campusPointsForMatchup.mockResolvedValue(CAMPUS)
  nbaCampusPointsForMatchup.mockResolvedValue({ home: { points: 15, missingPlayerIds: [], allFinal: true }, away: { points: 0, missingPlayerIds: [], allFinal: true } })
})

const league = (over: Record<string, unknown> = {}) => ({ sport: 'NFL', settings: {}, platform: 'af', leagueVariant: 'c2c', medianGame: false, ...over })

describe('campus points in the matchup score', () => {
  it('a native football C2C league adds each team’s campus points to its pro score', async () => {
    db.league.findFirst.mockResolvedValue(league())
    await updateMatchupScores('m1')
    expect(campusPointsForMatchup).toHaveBeenCalledWith(db, { season: 2026, nflWeek: 3, homeRosterId: 'H', awayRosterId: 'A' })
    const data = db.redraftMatchup.update.mock.calls[0]![0].data
    expect(data.homeScore).toBe(Math.round((data.awayScore + 21.5) * 100) / 100) // same pro lineup, + campus
    expect(data.lineupSnapshots.redraftScoring.campus).toEqual(CAMPUS)
  })

  it('adds NBA campus points and withholds a matchup with incomplete campus evidence', async () => {
    db.league.findFirst.mockResolvedValue(league({ sport: 'NBA' }))
    nbaCampusPointsForMatchup.mockResolvedValue({ home: { points: 15, missingPlayerIds: ['college-1'], allFinal: false }, away: { points: 0, missingPlayerIds: [], allFinal: true } })
    const result = await updateMatchupScores('m1')
    const data = db.redraftMatchup.update.mock.calls[0]![0].data
    expect(nbaCampusPointsForMatchup).toHaveBeenCalledOnce()
    expect(data.homeScore).toBe(Math.round((data.awayScore + 15) * 100) / 100)
    expect(data.status).toBe('active')
    expect(result?.missingPlayerIds).toContain('college-1')
  })

  it('keeps a matchup active while campus games are not final', async () => {
    db.league.findFirst.mockResolvedValue(league({ sport: 'NBA' }))
    nbaCampusPointsForMatchup.mockResolvedValue({ home: { points: 15, missingPlayerIds: [], allFinal: false }, away: { points: 0, missingPlayerIds: [], allFinal: true } })
    await updateMatchupScores('m1')
    expect(db.redraftMatchup.update.mock.calls[0]![0].data.status).toBe('active')
  })

  it('withholds an NBA bye when campus evidence is incomplete', async () => {
    db.league.findFirst.mockResolvedValue(league({ sport: 'NBA', medianGame: true }))
    db.redraftMatchup.findFirst.mockResolvedValue({ id: 'bye', leagueId: 'L1', seasonId: 's1', week: 3, homeRosterId: 'H', awayRosterId: null, homeRoster: {}, homeScore: 0, awayScore: 0, lineupSnapshots: null })
    nbaCampusPointsForMatchup.mockResolvedValue({ home: { points: 15, missingPlayerIds: ['college-1'], allFinal: false }, away: { points: 15, missingPlayerIds: ['college-1'], allFinal: false } })
    await updateMatchupScores('bye')
    const data = db.redraftMatchup.update.mock.calls[0]![0].data
    expect(data.status).toBe('active')
    expect(data.lineupSnapshots.redraftScoring.missingPlayerIds).toContain('college-1')
  })

  it('includes NBA campus points and finality in roster scores used by playoffs', async () => {
    db.league.findFirst.mockResolvedValue(league({ sport: 'NBA' }))
    nbaCampusPointsForMatchup.mockResolvedValue({ home: { points: 15, missingPlayerIds: ['college-1'], allFinal: false }, away: { points: 15, missingPlayerIds: ['college-1'], allFinal: false } })
    const score = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'H', week: 3, seasonYear: 2026 })
    expect(score.points).toBeGreaterThanOrEqual(15)
    expect(score.missingPlayerIds).toContain('college-1')
    expect(score.allFinal).toBe(false)
  })

  it('any other league is never asked', async () => {
    for (const over of [{ leagueVariant: 'devy_dynasty' }, { platform: 'sleeper' }, { sport: 'NHL' }, { sport: 'NBA', platform: 'sleeper' }]) {
      db.league.findFirst.mockResolvedValue(league(over))
      await updateMatchupScores('m1')
    }
    expect(campusPointsForMatchup).not.toHaveBeenCalled()
    expect(nbaCampusPointsForMatchup).not.toHaveBeenCalled()
    for (const [call] of db.redraftMatchup.update.mock.calls) {
      expect(call.data.homeScore).toBe(call.data.awayScore)
      expect(call.data.lineupSnapshots.redraftScoring.campus).toBeUndefined()
    }
  })

  it('a native NBA C2C league adds its college basketball campus points, by the week’s dates', async () => {
    const hoops = {
      home: { points: 31.25, missingPlayerIds: [], allFinal: true },
      away: { points: 0, missingPlayerIds: [], allFinal: true },
    }
    nbaCampusPointsForMatchup.mockResolvedValue(hoops)
    db.league.findFirst.mockResolvedValue(league({ sport: 'NBA' }))
    await updateMatchupScores('m1')
    expect(campusPointsForMatchup).not.toHaveBeenCalled()
    expect(nbaCampusPointsForMatchup).toHaveBeenCalledWith(db, expect.objectContaining({ leagueId: 'L1', season: 2026, week: 3, homeRosterId: 'H', awayRosterId: 'A' }))
    const data = db.redraftMatchup.update.mock.calls[0]![0].data
    expect(data.homeScore).toBe(Math.round((data.awayScore + 31.25) * 100) / 100)
    expect(data.lineupSnapshots.redraftScoring.campus).toEqual(hoops)
  })

  it('a bye team’s median score counts its campus starters', async () => {
    db.league.findFirst.mockResolvedValue(league({ medianGame: true }))
    db.redraftMatchup.findFirst.mockResolvedValue({
      id: 'bye', leagueId: 'L1', seasonId: 's1', week: 3, homeRosterId: 'H', awayRosterId: null,
      homeRoster: {}, homeScore: 0, awayScore: 0, lineupSnapshots: null,
    })
    await updateMatchupScores('bye')
    expect(campusPointsForMatchup).toHaveBeenCalledWith(db, { season: 2026, nflWeek: 3, homeRosterId: 'H', awayRosterId: 'H' })
    const data = db.redraftMatchup.update.mock.calls[0]![0].data
    expect(data.lineupSnapshots.redraftScoring.campus).toEqual({ cfbWeeks: [2], home: CAMPUS.home })
    expect(data.homeScore).toBeGreaterThan(21.5)
  })
})
