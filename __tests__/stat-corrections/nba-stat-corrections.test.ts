import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  devy: vi.fn(async () => false),
  c2c: vi.fn(async () => false),
  prisma: {
    redraftSeason: { findUnique: vi.fn() },
    redraftMatchup: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    redraftRosterPlayer: { findMany: vi.fn() },
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

import { checkStatCorrectionsForSeason } from '@/lib/stat-corrections/statCorrectionDetector'

/**
 * NBA head-to-head leagues with weekly lineups: the week is re-summed from the game table
 * (lib/stat-corrections/dailyWeekStats.ts) and compared with the sealed weekly stats.
 */
const NOW = Date.parse('2026-11-10T12:00:00Z')
const snapshot = { redraftScoring: { scoredAt: new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString() } }

// The real NBA scorer: 30 pts / 10 reb / 5 ast; the official box score later took two rebounds away.
const STORED = { pts: 30, reb: 10, ast: 5 }
const FRESH = { pts: 30, reb: 8, ast: 5 }

function seed(over: { sport?: string; settings?: Record<string, unknown> } = {}) {
  const sport = over.sport ?? 'NBA'
  m.prisma.redraftSeason.findUnique.mockResolvedValue({
    id: 'S', leagueId: 'L', season: 2026, sport,
    league: { platform: 'allfantasy', sport, settings: over.settings ?? {}, bestBallMode: false, leagueVariant: null, leagueType: null },
  })
  m.prisma.redraftMatchup.findFirst.mockResolvedValue({ week: 3 })
  m.prisma.redraftMatchup.findMany.mockResolvedValue([
    { id: 'm1', status: 'final', homeRosterId: 'A', awayRosterId: 'B', homeScore: 200, awayScore: 199, lineupSnapshots: snapshot },
  ])
  m.prisma.redraftRosterPlayer.findMany.mockResolvedValue([
    { rosterId: 'A', playerId: 'g1', playerName: 'Guard One', position: 'PG', slotType: 'PG', sport },
  ])
  m.prisma.playerWeeklyScore.findMany.mockResolvedValue([{ playerId: 'g1', stats: STORED }])
  m.prisma.sportsDataCache.findUnique.mockResolvedValue(null)
}

const fetchStats = vi.fn()
const fetchDailyStats = vi.fn()
const run = () => checkStatCorrectionsForSeason('S', { now: NOW, fetchStats, fetchDailyStats, ownerHasPlan: async () => false })

beforeEach(() => {
  vi.clearAllMocks()
  m.devy.mockResolvedValue(false)
  m.c2c.mockResolvedValue(false)
  fetchDailyStats.mockResolvedValue(new Map([['g1', FRESH]]))
  seed()
})

describe('NBA stat corrections', () => {
  it('re-sums the week from the game table and logs the correction, scored by the league\'s NBA rules', async () => {
    expect(await run()).toBe('changes_logged')
    expect(fetchStats).not.toHaveBeenCalled()
    expect(fetchDailyStats).toHaveBeenCalledWith({ sport: 'NBA', season: 2026, week: 3, players: [{ playerId: 'g1', playerName: 'Guard One' }] })
    expect(m.prisma.playerWeeklyScore.findMany.mock.calls[0]![0].where).toMatchObject({ sport: 'NBA', week: 3 })
    const logged = m.prisma.leagueAuditLog.create.mock.calls[0]![0].data
    expect(logged.afterState.changes).toHaveLength(1)
    expect(logged.afterState.matchups[0]).toMatchObject({ matchupId: 'm1', resultFlipped: true })
  })

  it('an unchanged box score is no change', async () => {
    fetchDailyStats.mockResolvedValue(new Map([['g1', STORED]]))
    expect(await run()).toBe('no_change')
    expect(m.prisma.leagueAuditLog.create).not.toHaveBeenCalled()
  })

  it('a daily-lineup NBA league is not covered: a weekly re-sum cannot match day-by-day starters', async () => {
    seed({ settings: { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } } })
    expect(await run()).toBe('not_supported')
    expect(fetchDailyStats).not.toHaveBeenCalled()
  })

  it('other daily sports stay out until they are checked', async () => {
    seed({ sport: 'NHL' })
    expect(await run()).toBe('not_supported')
  })
})
