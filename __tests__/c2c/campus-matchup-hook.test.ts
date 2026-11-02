import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The C2C campus points (lib/c2c/campusScoring.ts) are added to each team's pro score in the one
 * matchup scorer the live sync and the week seal both run — and to a bye team's median score.
 */

const { db, campusPointsForMatchup, campusBasketballPointsForMatchup } = vi.hoisted(() => ({
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
  campusBasketballPointsForMatchup: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/c2c/campusScoring', async () => ({
  campusPointsForMatchup,
  campusBasketballPointsForMatchup,
  campusSport: (await vi.importActual<typeof import('@/lib/c2c/campusLineup')>('@/lib/c2c/campusLineup')).campusSport,
}))
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

  it('any other league is never asked', async () => {
    for (const over of [{ leagueVariant: 'devy_dynasty' }, { platform: 'sleeper' }, { sport: 'NHL' }, { sport: 'NBA', platform: 'sleeper' }]) {
      db.league.findFirst.mockResolvedValue(league(over))
      await updateMatchupScores('m1')
    }
    expect(campusPointsForMatchup).not.toHaveBeenCalled()
    expect(campusBasketballPointsForMatchup).not.toHaveBeenCalled()
    for (const [call] of db.redraftMatchup.update.mock.calls) {
      expect(call.data.homeScore).toBe(call.data.awayScore)
      expect(call.data.lineupSnapshots.redraftScoring.campus).toBeUndefined()
    }
  })

  it('a native NBA C2C league adds its college basketball campus points, by the week’s dates', async () => {
    const hoops = {
      window: { start: '2026-11-02T00:00:00.000Z', end: '2026-11-09T00:00:00.000Z' },
      home: { points: 31.25, players: [{ playerId: 'c1', points: 31.25 }] },
      away: { points: 0, players: [] },
    }
    campusBasketballPointsForMatchup.mockResolvedValue(hoops)
    db.league.findFirst.mockResolvedValue(league({ sport: 'NBA' }))
    await updateMatchupScores('m1')
    expect(campusPointsForMatchup).not.toHaveBeenCalled()
    expect(campusBasketballPointsForMatchup).toHaveBeenCalledWith(db, { season: 2026, week: 3, homeRosterId: 'H', awayRosterId: 'A' })
    const data = db.redraftMatchup.update.mock.calls[0]![0].data
    expect(data.homeScore).toBe(Math.round((data.awayScore + 31.25) * 100) / 100)
    expect(data.lineupSnapshots.redraftScoring.campus).toEqual(hoops)
    expect(data.status).toBe('active')
    expect(data.lineupSnapshots.redraftScoring.campusPending).toBe(true)
  })

  it('keeps NBA campus byes and playoff roster scores provisional without complete college evidence', async () => {
    const hoops = { window: null, home: { points: 0, players: [{ playerId: 'c1', points: 0 }] }, away: { points: 0, players: [] } }
    campusBasketballPointsForMatchup.mockResolvedValue(hoops)
    db.league.findFirst.mockResolvedValue(league({ sport: 'NBA', medianGame: true }))
    db.redraftMatchup.findFirst.mockResolvedValue({ id: 'bye', leagueId: 'L1', seasonId: 's1', week: 3, homeRosterId: 'H', awayRosterId: null, homeRoster: {}, lineupSnapshots: null })
    await updateMatchupScores('bye')
    expect(db.redraftMatchup.update.mock.calls[0]![0].data).toMatchObject({ status: 'active', lineupSnapshots: { redraftScoring: { campusPending: true } } })
    const result = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'H', week: 3, seasonYear: 2026 })
    expect(result.allFinal).toBe(false)
    expect(result.missingPlayerIds).toContain('campus-evidence-pending')
  })

  it('does not hold an NBA league with no campus lineup', async () => {
    campusBasketballPointsForMatchup.mockResolvedValue(null)
    db.league.findFirst.mockResolvedValue(league({ sport: 'NBA' }))
    await updateMatchupScores('m1')
    expect(db.redraftMatchup.update.mock.calls[0]![0].data.status).toBe('final')
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
