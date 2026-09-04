import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/workers/providers/rolling-insights', () => ({
  rollingInsightsProvider: vi.fn(),
}))

import {
  auditNflRollingInsightsIdentity,
  backfillNflRollingInsightsIdentities,
  normalizeNflScheduleGame,
  syncNflFoundationSchedule,
  syncNflFoundationSeasonStats,
} from '@/lib/nfl-data-foundation/nflFoundationSync'
import {
  buildCanonicalNflProjection,
  dedupeCanonicalNflDraftPoolEntries,
  dedupeCanonicalNflPlayers,
  generateAndPersistCanonicalNflProjections,
} from '@/lib/nfl-data-foundation/nflDataFoundationService'
import type { CanonicalNflPlayer } from '@/lib/nfl-data-foundation/types'

const basePlayer = (overrides: Partial<CanonicalNflPlayer>): CanonicalNflPlayer => ({
  playerId: 'af-1',
  playerName: 'Test Player',
  normalizedName: 'test player',
  position: 'RB',
  team: 'SF',
  teamId: null,
  jerseyNumber: null,
  status: null,
  injuryStatus: null,
  headshotUrl: null,
  byeWeek: null,
  opponent: null,
  depthChartRank: null,
  depthChartRole: null,
  providerIds: {
    allFantasyId: 'af-1',
    providerPlayerId: null,
    rollingInsightsId: null,
    sleeperId: null,
    fantasyCalcId: null,
  },
  seasonStats: null,
  projection: null,
  adp: null,
  tradeValue: null,
  dataSources: [],
  staleDataWarnings: [],
  ...overrides,
})

describe('NFL foundation sync utilities', () => {
  // Only one test pins the clock; hand it back so nothing after it inherits fake timers.
  afterEach(() => {
    vi.useRealTimers()
  })

  it('builds Rolling Insights REST paths from the requested season year', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/workers/providers/rolling-insights.ts'), 'utf8')
    expect(src).toContain('function requestedYearFromQuery')
    expect(src).toContain('buildRestPathCandidates(dataSeg, chainSport, requestedYearFromQuery(merged))')
  })

  it('normalizes RI schedule rows to GameSchedule rows only when week is present', () => {
    const normalized = normalizeNflScheduleGame(
      {
        gameId: 'game-1',
        awayTeam: 'Dallas Cowboys',
        homeTeam: 'Philadelphia Eagles',
        awayTeamId: 'dal-id',
        homeTeamId: 'phi-id',
        week: 1,
        date: '2026-09-10T00:20:00.000Z',
        status: 'Scheduled',
        season: '2026-2027',
        venue: { arena: 'Lincoln Financial Field', city: 'Philadelphia', state: 'PA', dome: false },
      },
      2026,
    )

    expect(normalized).toMatchObject({
      sportType: 'NFL',
      season: 2026,
      weekOrRound: 1,
      externalId: 'game-1',
      homeTeam: 'PHI',
      awayTeam: 'DAL',
      venue: 'Lincoln Financial Field',
    })

    expect(
      normalizeNflScheduleGame(
        {
          gameId: 'missing-week',
          awayTeam: 'DAL',
          homeTeam: 'PHI',
          date: '2026-09-10T00:20:00.000Z',
          status: 'scheduled',
          season: '2026',
          venue: null,
        },
        2026,
      ),
    ).toBeNull()
  })

  it('probes 2026 and 2026-2027 schedules in dry-run without writing', async () => {
    /*
     * ⚠ THE CLOCK IS PINNED BECAUSE THIS ASSERTION SILENTLY DEPENDS ON IT.
     *
     * rollingInsightsScheduleSeasonCandidates(season) returns
     *   unique([String(season), rollingInsightsSeasonRange(season), getCurrentNFLSeason()])
     * and that third entry is derived from the wall clock. Today it is '2026-2027',
     * which unique() collapses into the second entry, so the probe list is the two
     * seasons this test names. Once the real NFL season rolls over, getCurrentNFLSeason()
     * returns '2027-2028', the list becomes three entries, and this test fails with no
     * commit to blame -- the same shape as the survivor-voting deadline that sat red for
     * four days because nothing changed and nobody could bisect it.
     *
     * The product code is CORRECT: probing the current season alongside the requested one
     * is deliberate. It is the assertion that was assuming what year it is, so the fix is
     * to say so rather than to loosen the expectation -- a toContain here would still pass
     * if the candidate list silently lost an entry.
     */
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z')) // inside the 2026-2027 NFL season

    const upsert = vi.fn()
    const fetchSchedule = vi.fn(async ({ season }: { season?: string }) =>
      season === '2026-2027'
        ? [
            {
              gameId: 'game-1',
              awayTeam: 'DAL',
              homeTeam: 'PHI',
              week: 1,
              date: '2026-09-10T00:20:00.000Z',
              status: 'scheduled',
              season: '2026-2027',
              venue: null,
            },
          ]
        : [],
    )

    const report = await syncNflFoundationSchedule({
      season: 2026,
      write: false,
      prismaClient: { gameSchedule: { upsert } } as never,
      fetchSchedule: fetchSchedule as never,
    })

    expect(report.mode).toBe('dry-run')
    expect(report.selectedRollingInsightsSeason).toBe('2026-2027')
    expect(report.validForGameSchedule).toBe(1)
    expect(report.written).toBe(0)
    expect(upsert).not.toHaveBeenCalled()
    expect(fetchSchedule.mock.calls.map(([arg]) => arg.season)).toEqual(['2026', '2026-2027'])
  })

  it('writes schedule rows only in write mode', async () => {
    const upsert = vi.fn()
    const fetchSchedule = vi.fn(async () => [
      {
        gameId: 'game-1',
        awayTeam: 'DAL',
        homeTeam: 'PHI',
        week: 1,
        date: '2026-09-10T00:20:00.000Z',
        status: 'scheduled',
        season: '2026',
        venue: null,
      },
    ])

    const report = await syncNflFoundationSchedule({
      season: 2026,
      write: true,
      prismaClient: { gameSchedule: { upsert } } as never,
      fetchSchedule: fetchSchedule as never,
    })

    expect(report.written).toBe(1)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sportType_season_weekOrRound_externalId: {
            sportType: 'NFL',
            season: 2026,
            weekOrRound: 1,
            externalId: 'game-1',
          },
        },
      }),
    )
  })

  it('normalizes player-stats rows to PlayerSeasonStats candidates without dry-run writes', async () => {
    const upsert = vi.fn()
    const db = {
      sportsPlayer: {
        findMany: vi.fn().mockResolvedValue([{ externalId: '100', name: 'Joe Runner', position: 'RB', team: 'SF' }]),
      },
      playerSeasonStats: { upsert },
    }
    const fetchStats = vi.fn(async () => [
      {
        player_id: '100',
        player: 'Joe Runner',
        team: 'SF',
        regular_season: {
          DK_fantasy_points: 170,
          DK_fantasy_points_per_game: 10,
          games_played: 17,
        },
      },
      { player_id: '101', player: 'No Stats', regular_season: null },
    ])

    const report = await syncNflFoundationSeasonStats({
      season: 2026,
      write: false,
      prismaClient: db as never,
      fetchStats: fetchStats as never,
    })

    expect(report.providerRows).toBe(2)
    expect(report.rowsWithRegularSeason).toBe(1)
    expect(report.rowsWithFantasyPoints).toBe(1)
    expect(report.matchedSportsPlayers).toBe(1)
    expect(report.writeCandidates).toBe(1)
    expect(report.written).toBe(0)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('falls back to the previous stats season when the requested season has no played stats', async () => {
    const db = {
      sportsPlayer: {
        findMany: vi.fn().mockResolvedValue([{ externalId: '100', name: 'Joe Runner', position: 'RB', team: 'SF' }]),
      },
      playerSeasonStats: { upsert: vi.fn() },
    }
    const fetchStats = vi.fn(async ({ season }: { season?: string }) =>
      season === '2025'
        ? [
            {
              player_id: '100',
              player: 'Joe Runner',
              team: 'SF',
              regular_season: {
                DK_fantasy_points: 170,
                DK_fantasy_points_per_game: 10,
                games_played: 17,
              },
            },
          ]
        : [],
    )

    const report = await syncNflFoundationSeasonStats({
      season: 2026,
      write: false,
      prismaClient: db as never,
      fetchStats: fetchStats as never,
    })

    expect(report.requestedSeason).toBe('2026')
    expect(report.season).toBe('2025')
    expect(report.fallbackSeasonUsed).toBe(true)
    expect(report.writeCandidates).toBe(1)
  })

  it('writes PlayerSeasonStats only when write mode is set', async () => {
    const upsert = vi.fn()
    const db = {
      sportsPlayer: {
        findMany: vi.fn().mockResolvedValue([{ externalId: '100', name: 'Joe Runner', position: 'RB', team: 'SF' }]),
      },
      playerSeasonStats: { upsert },
    }
    const fetchStats = vi.fn(async () => [
      {
        player_id: '100',
        player: 'Joe Runner',
        team: 'SF',
        regular_season: {
          DK_fantasy_points: 170,
          DK_fantasy_points_per_game: 10,
          games_played: 17,
        },
      },
    ])

    const report = await syncNflFoundationSeasonStats({
      season: '2026-2027',
      write: true,
      prismaClient: db as never,
      fetchStats: fetchStats as never,
    })

    expect(report.written).toBe(1)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sport_playerId_season_seasonType_source: {
            sport: 'NFL',
            playerId: '100',
            season: '2026',
            seasonType: 'regular',
            source: 'rolling_insights',
          },
        },
      }),
    )
  })

  it('audits identity buckets and dry-run backfill without overwriting existing IDs', async () => {
    const update = vi.fn()
    const create = vi.fn()
    const db = {
      sportsPlayer: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'sp-1', externalId: 'ri-1', name: 'Matched Id', position: 'QB', team: 'KC', source: 'rolling_insights' },
          { id: 'sp-2', externalId: 'ri-2', name: 'Matched Name', position: 'RB', team: 'SF', source: 'rolling_insights' },
          { id: 'sp-3', externalId: 'ri-3', name: 'New Player', position: 'WR', team: 'DAL', source: 'rolling_insights' },
          { id: 'sp-4', externalId: 'ri-4', name: 'New Player', position: 'WR', team: 'DAL', source: 'rolling_insights' },
        ]),
      },
      playerIdentityMap: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'id-1',
            canonicalName: 'Matched Id',
            normalizedName: 'matched id',
            position: 'QB',
            currentTeam: 'KC',
            rollingInsightsId: 'ri-1',
          },
          {
            id: 'id-2',
            canonicalName: 'Matched Name',
            normalizedName: 'matched name',
            position: 'RB',
            currentTeam: 'SF',
            rollingInsightsId: null,
          },
        ]),
        update,
        create,
      },
    }

    const audit = await auditNflRollingInsightsIdentity({ prismaClient: db as never })
    expect(audit.matchedByRollingInsightsId).toBe(1)
    expect(audit.matchedByNameTeamPosition).toBe(1)
    expect(audit.unmatched).toBe(2)
    expect(audit.duplicateCandidateGroups).toBe(1)

    const backfill = await backfillNflRollingInsightsIdentities({ write: false, prismaClient: db as never })
    expect(backfill.updated).toBe(1)
    expect(backfill.created).toBe(2)
    expect(backfill.skippedExistingRollingInsightsId).toBe(1)
    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('dedupes canonical draft and waiver-style pools by name/team/position', () => {
    const waiverPool = dedupeCanonicalNflPlayers([
      basePlayer({
        playerId: 'weak',
        playerName: 'Duplicate Runner',
        position: 'RB',
        team: 'SF',
        providerIds: { allFantasyId: 'weak', providerPlayerId: null, rollingInsightsId: null, sleeperId: null, fantasyCalcId: null },
      }),
      basePlayer({
        playerId: 'strong',
        playerName: 'Duplicate Runner',
        position: 'RB',
        team: 'SF',
        providerIds: { allFantasyId: 'strong', providerPlayerId: 'ri-1', rollingInsightsId: 'ri-1', sleeperId: null, fantasyCalcId: null },
        projection: buildCanonicalNflProjection({
          playerId: 'strong',
          playerName: 'Duplicate Runner',
          position: 'RB',
          team: 'SF',
          season: 2026,
          week: 1,
          rollingInsightsFantasyPointsPerGame: 12,
          rollingInsightsGamesPlayed: 17,
        }),
      }),
    ])
    expect(waiverPool).toHaveLength(1)
    expect(waiverPool[0]?.playerId).toBe('strong')

    const draftPool = dedupeCanonicalNflDraftPoolEntries([
      { id: 'a', name: 'Duplicate Runner', position: 'RB', team: 'SF', canonicalNfl: { providerIds: { allFantasyId: 'a' } } },
      {
        id: 'b',
        name: 'Duplicate Runner',
        position: 'RB',
        team: 'SF',
        canonicalNfl: {
          providerIds: { allFantasyId: 'b', rollingInsightsId: 'ri-1' },
          projection: { projectedPoints: 12, confidence: 75 },
        },
      },
    ])
    expect(draftPool).toHaveLength(1)
    expect(draftPool[0]?.id).toBe('b')
  })

  it('generates weekly and ROS projection candidates from available normalized data', async () => {
    const upsert = vi.fn()
    const db = {
      sportsPlayer: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'sp-1',
            sport: 'NFL',
            externalId: 'ri-1',
            name: 'Projection Runner',
            position: 'RB',
            team: 'SF',
            teamId: null,
            number: null,
            imageUrl: null,
            sleeperId: null,
            status: null,
            source: 'rolling_insights',
            fetchedAt: new Date(),
            expiresAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      },
      playerIdentityMap: { findFirst: vi.fn().mockResolvedValue(null) },
      playerSeasonStats: {
        findMany: vi.fn().mockResolvedValue([
          {
            playerId: 'ri-1',
            fantasyPoints: 170,
            fantasyPointsPerGame: 10,
            gamesPlayed: 17,
            stats: { DK_fantasy_points_per_game: 10, games_played: 17 },
            source: 'rolling_insights',
            fetchedAt: new Date(),
          },
        ]),
      },
      sportsInjury: { findFirst: vi.fn().mockResolvedValue(null) },
      injuryReportRecord: { findFirst: vi.fn().mockResolvedValue(null) },
      depthChart: { findMany: vi.fn().mockResolvedValue([]) },
      gameSchedule: {
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({ homeTeam: 'SF', awayTeam: 'DAL' }),
      },
      allFantasyAdpSnapshot: { findFirst: vi.fn().mockResolvedValue(null) },
      fantasyProjection: { findFirst: vi.fn().mockResolvedValue(null) },
      aFProjectionSnapshot: { findFirst: vi.fn().mockResolvedValue(null), upsert },
      sportsPlayerRecord: { findFirst: vi.fn().mockResolvedValue(null) },
      teamSeasonStats: { findFirst: vi.fn().mockResolvedValue(null) },
    }

    const dryRun = await generateAndPersistCanonicalNflProjections({
      season: 2026,
      week: 1,
      limit: 10,
      write: false,
      prismaClient: db as never,
    })
    expect(dryRun.generated).toBe(1)
    expect(dryRun.persisted).toBe(0)
    expect(upsert).not.toHaveBeenCalled()

    const writeRun = await generateAndPersistCanonicalNflProjections({
      season: 2026,
      week: 1,
      limit: 10,
      write: true,
      prismaClient: db as never,
    })
    expect(writeRun.persisted).toBe(1)
    expect(writeRun.rosPersisted).toBe(1)
    expect(upsert).toHaveBeenCalledTimes(2)
  })
})
