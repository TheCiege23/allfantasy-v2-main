import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  devy: vi.fn(async () => false),
  c2c: vi.fn(async () => false),
  gamesLimits: vi.fn((): unknown => null),
  prisma: {
    redraftSeason: { findUnique: vi.fn() },
    redraftMatchup: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    redraftRosterPlayer: { findMany: vi.fn() },
    redraftDailyLineup: { findMany: vi.fn() },
    playerDailyScore: { findMany: vi.fn() },
    roster: { findMany: vi.fn(async () => []) },
    afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
    playerWeeklyScore: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    sportsDataCache: { findUnique: vi.fn(), upsert: vi.fn() },
    leagueAuditLog: { create: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({ leagueUsesDevyEngine: m.devy, calculateOfficialTeamScore: vi.fn() }))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: m.c2c, updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/redraft/gamesLimits', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/redraft/gamesLimits')>()),
  readGamesLimits: m.gamesLimits,
}))
// Week 3 is Mon 2 Nov – Sun 8 Nov (Eastern day keys); the opener table is not what is under test.
vi.mock('@/lib/season-week/deriveDailySportSeasonStart', () => ({ ensureDailySportSeasonStart: vi.fn(async () => undefined) }))
vi.mock('@/lib/season-week/dailySportSeasonStarts', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/season-week/dailySportSeasonStarts')>()),
  resolveDailySportWeekWindow: () => ({ start: new Date('2026-11-02T00:00:00Z'), end: new Date('2026-11-09T00:00:00Z') }),
}))

import { checkStatCorrectionsForSeason } from '@/lib/stat-corrections/statCorrectionDetector'

/**
 * NBA head-to-head leagues with DAILY lineups: each day is scored on that day's starters, so the
 * check compares each day he started — never a day he sat — with the line that day was scored on.
 */
const NOW = Date.parse('2026-11-10T12:00:00Z')
const snapshot = { redraftScoring: { scoredAt: new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString() } }
const DAILY = { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } }
const day = (d: string) => new Date(`${d}T00:00:00Z`)

const LINE = { pts: 30, reb: 10, ast: 5 }
const LINE_MINUS_2_REB = { pts: 30, reb: 8, ast: 5 }

function seed(over: { settings?: Record<string, unknown>; players?: unknown[]; dailyRows?: unknown[]; sport?: string; lines?: [Record<string, number>, Record<string, number>] } = {}) {
  const sport = over.sport ?? 'NBA'
  m.prisma.redraftSeason.findUnique.mockResolvedValue({
    id: 'S', leagueId: 'L', season: 2026, sport,
    league: { platform: 'allfantasy', sport, settings: over.settings ?? DAILY, bestBallMode: false, leagueVariant: null, leagueType: null },
  })
  m.prisma.redraftMatchup.findFirst.mockResolvedValue({ week: 3 })
  // A 2-point game: one day's two rebounds decide it.
  m.prisma.redraftMatchup.findMany.mockResolvedValue([
    { id: 'm1', status: 'final', homeRosterId: 'A', awayRosterId: 'B', homeScore: 200, awayScore: 199, lineupSnapshots: snapshot },
  ])
  m.prisma.redraftRosterPlayer.findMany.mockResolvedValue(
    over.players ?? [
      { rosterId: 'A', playerId: 'g1', playerName: 'Guard One', position: 'PG', slotType: 'PG', sport, addedAt: day('2026-10-01'), droppedAt: null },
    ],
  )
  // Started Monday, benched from Wednesday on.
  m.prisma.redraftDailyLineup.findMany.mockResolvedValue(
    over.dailyRows ?? [
      { rosterId: 'A', playerId: 'g1', scoringDay: day('2026-11-02'), slotType: 'PG' },
      { rosterId: 'A', playerId: 'g1', scoringDay: day('2026-11-04'), slotType: 'BN' },
    ],
  )
  // He played Tuesday (started) and Wednesday (benched).
  m.prisma.playerDailyScore.findMany.mockResolvedValue([
    { playerId: 'g1', scoringDay: day('2026-11-03'), stats: over.lines?.[0] ?? LINE, isFinalized: true },
    { playerId: 'g1', scoringDay: day('2026-11-04'), stats: over.lines?.[1] ?? LINE, isFinalized: true },
  ])
  m.prisma.sportsDataCache.findUnique.mockResolvedValue(null)
}

const fetchDailyStats = vi.fn()
const fetchDailyDayStats = vi.fn()
const run = () => checkStatCorrectionsForSeason('S', { now: NOW, fetchDailyStats, fetchDailyDayStats, ownerHasPlan: async () => false })
const fresh = (days: Record<string, Record<string, number>>) => new Map([['g1', new Map(Object.entries(days))]])

beforeEach(() => {
  vi.clearAllMocks()
  m.devy.mockResolvedValue(false)
  m.c2c.mockResolvedValue(false)
  m.gamesLimits.mockReturnValue(null)
  seed()
})

describe('NBA daily-lineup stat corrections', () => {
  it('a correction to a day he STARTED is logged, scored on that day alone', async () => {
    fetchDailyDayStats.mockResolvedValue(fresh({ '2026-11-03': LINE_MINUS_2_REB, '2026-11-04': LINE }))
    expect(await run()).toBe('changes_logged')
    expect(fetchDailyStats).not.toHaveBeenCalled()
    expect(fetchDailyDayStats).toHaveBeenCalledWith({ sport: 'NBA', season: 2026, week: 3, players: [{ playerId: 'g1', playerName: 'Guard One' }] })
    const logged = m.prisma.leagueAuditLog.create.mock.calls[0]![0].data
    expect(logged.afterState.changes).toHaveLength(1)
    const change = logged.afterState.changes[0]
    expect(change.delta).toBeLessThan(0)
    // One day's line, not two: the benched Wednesday is not in "before".
    expect(change.before).toBeGreaterThan(0)
    expect(logged.afterState.matchups[0]).toMatchObject({ matchupId: 'm1', resultFlipped: true })
  })

  it('a correction to a day he was BENCHED is no change — it never scored', async () => {
    fetchDailyDayStats.mockResolvedValue(fresh({ '2026-11-03': LINE, '2026-11-04': LINE_MINUS_2_REB }))
    expect(await run()).toBe('no_change')
    expect(m.prisma.leagueAuditLog.create).not.toHaveBeenCalled()
  })

  it('a player dropped mid-week still has his started days checked', async () => {
    seed({
      players: [
        { rosterId: 'A', playerId: 'g1', playerName: 'Guard One', position: 'PG', slotType: 'PG', sport: 'NBA', addedAt: day('2026-10-01'), droppedAt: new Date('2026-11-03T23:00:00Z') },
      ],
      dailyRows: [{ rosterId: 'A', playerId: 'g1', scoringDay: day('2026-11-02'), slotType: 'PG' }],
    })
    fetchDailyDayStats.mockResolvedValue(fresh({ '2026-11-03': LINE_MINUS_2_REB, '2026-11-04': LINE }))
    expect(await run()).toBe('changes_logged')
    expect(m.prisma.redraftRosterPlayer.findMany.mock.calls[0]![0].where).toMatchObject({ OR: [{ droppedAt: null }, { droppedAt: { gte: day('2026-11-02') } }] })
  })

  it('a starter missing from the re-read entirely is unchecked, not a wiped-out week', async () => {
    fetchDailyDayStats.mockResolvedValue(new Map([['someone-else', new Map([['2026-11-03', LINE]])]]))
    expect(await run()).toBe('no_change')
    const review = m.prisma.sportsDataCache.upsert.mock.calls[0]![0].create.data.review
    expect(review.unchecked).toBe(1)
  })

  it('games limits stay not covered: a day line alone does not say what counted', async () => {
    m.gamesLimits.mockReturnValue({ gamesPlayedCaps: { PG: 10 } })
    expect(await run()).toBe('not_supported')
    expect(fetchDailyDayStats).not.toHaveBeenCalled()
  })

  it('a weekly-lineup NBA league still uses the weekly re-sum', async () => {
    seed({ settings: {} })
    m.prisma.playerWeeklyScore.findMany.mockResolvedValue([{ playerId: 'g1', stats: LINE }])
    fetchDailyStats.mockResolvedValue(new Map([['g1', LINE]]))
    expect(await run()).toBe('no_change')
    expect(fetchDailyDayStats).not.toHaveBeenCalled()
    expect(m.prisma.redraftDailyLineup.findMany).not.toHaveBeenCalled()
  })

  // MLB and NHL daily-lineup leagues: the same day-by-day check, scored by each sport's real defaults.
  it.each([
    ['NHL', { g: 1, a: 1 }, { g: 1, a: 0 }, -2], // an assist taken away
    ['MLB', { r: 1, hr: 1, rbi: 1 }, { r: 1, hr: 0, rbi: 1 }, -4], // a home run re-scored
  ])('%s: a started-day correction is logged; the same correction on a benched day is not', async (sport, line, corrected, delta) => {
    seed({ sport, lines: [line, line] })
    fetchDailyDayStats.mockResolvedValue(fresh({ '2026-11-03': corrected, '2026-11-04': line }))
    expect(await run()).toBe('changes_logged')
    expect(fetchDailyDayStats).toHaveBeenCalledWith(expect.objectContaining({ sport, week: 3 }))
    expect(m.prisma.leagueAuditLog.create.mock.calls[0]![0].data.afterState.changes[0].delta).toBe(delta)

    vi.clearAllMocks()
    seed({ sport, lines: [line, line] })
    fetchDailyDayStats.mockResolvedValue(fresh({ '2026-11-03': line, '2026-11-04': corrected }))
    expect(await run()).toBe('no_change')
  })
})
