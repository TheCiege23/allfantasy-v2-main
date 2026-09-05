import { beforeEach, describe, expect, it, vi } from 'vitest'

const leagueFindFirstMock = vi.fn()
const leagueCreateMock = vi.fn()
const leagueUpdateMock = vi.fn()
const bootstrapLeagueFromImportMock = vi.fn()
const bootstrapLeagueDraftConfigMock = vi.fn()
const bootstrapLeagueWaiverSettingsMock = vi.fn()
const bootstrapLeaguePlayoffConfigMock = vi.fn()
const bootstrapLeagueScheduleConfigMock = vi.fn()
const syncSleeperHistoricalBackfillAfterImportMock = vi.fn()
const syncFantraxHistoricalBackfillAfterImportMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    /*
     * ⚠ ADDED FOR THE TOMBSTONE FEATURE (de9bda225, "a deleted league stays deleted").
     * The delete/import paths now call prisma.deletedLeagueTombstone, and a mock without
     * it fails as "Cannot read properties of undefined (reading 'upsert'/'findUnique')" —
     * which reads as a broken route rather than a mock that has not kept up.
     */
    deletedLeagueTombstone: {
      upsert: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    league: {
      findFirst: leagueFindFirstMock,
      create: leagueCreateMock,
      update: leagueUpdateMock,
    },
  },
}))

vi.mock('@/lib/league-import/LeagueCreationBootstrapService', () => ({
  bootstrapLeagueFromImport: bootstrapLeagueFromImportMock,
}))

vi.mock('@/lib/draft-defaults/LeagueDraftBootstrapService', () => ({
  bootstrapLeagueDraftConfig: bootstrapLeagueDraftConfigMock,
}))

vi.mock('@/lib/waiver-defaults/LeagueWaiverBootstrapService', () => ({
  bootstrapLeagueWaiverSettings: bootstrapLeagueWaiverSettingsMock,
}))

vi.mock('@/lib/playoff-defaults/LeaguePlayoffBootstrapService', () => ({
  bootstrapLeaguePlayoffConfig: bootstrapLeaguePlayoffConfigMock,
}))

vi.mock('@/lib/schedule-defaults/LeagueScheduleBootstrapService', () => ({
  bootstrapLeagueScheduleConfig: bootstrapLeagueScheduleConfigMock,
}))

vi.mock('@/lib/league-import/sleeper/SleeperHistoricalBackfillService', () => ({
  syncSleeperHistoricalBackfillAfterImport: syncSleeperHistoricalBackfillAfterImportMock,
}))

vi.mock('@/lib/league-import/fantrax/FantraxHistoricalBackfillService', () => ({
  syncFantraxHistoricalBackfillAfterImport: syncFantraxHistoricalBackfillAfterImportMock,
}))

const calculateAndSaveRankMock = vi.fn()
vi.mock('@/lib/rank/calculateRank', () => ({
  calculateAndSaveRank: calculateAndSaveRankMock,
}))

describe('ImportedLeagueCommitService source tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    calculateAndSaveRankMock.mockResolvedValue(null)
    leagueFindFirstMock.mockResolvedValue(null)
    leagueCreateMock.mockResolvedValue({
      id: 'league-abc',
      name: 'Imported League',
      sport: 'NFL',
    })
    bootstrapLeagueFromImportMock.mockResolvedValue(undefined)
    bootstrapLeagueDraftConfigMock.mockResolvedValue(undefined)
    bootstrapLeagueWaiverSettingsMock.mockResolvedValue(undefined)
    bootstrapLeaguePlayoffConfigMock.mockResolvedValue(undefined)
    bootstrapLeagueScheduleConfigMock.mockResolvedValue(undefined)
    syncSleeperHistoricalBackfillAfterImportMock.mockResolvedValue({ status: 'queued' })
    syncFantraxHistoricalBackfillAfterImportMock.mockResolvedValue({ status: 'queued-fantrax' })
  })

  it('stores source metadata and identity mappings on imported league', async () => {
    const { persistImportedLeagueFromNormalization } = await import(
      '@/lib/league-import/ImportedLeagueCommitService'
    )

    const result = await persistImportedLeagueFromNormalization({
      userId: 'u1',
      provider: 'sleeper',
      normalized: {
        source: {
          source_provider: 'sleeper',
          source_league_id: '12345',
          source_season_id: '2025',
          import_batch_id: 'sleeper-12345-batch',
          imported_at: '2026-03-20T00:00:00.000Z',
        },
        league: {
          name: 'Imported League',
          sport: 'NFL',
          season: 2025,
          leagueSize: 12,
          rosterSize: 16,
          scoring: 'ppr',
          isDynasty: true,
        },
        rosters: [],
        scoring: null,
        schedule: [],
        draft_picks: [],
        transactions: [],
        standings: [],
        player_map: {},
        identity_mappings: [
          {
            source_provider: 'sleeper',
            source_id: '12345',
            entity_type: 'league',
            stable_key: 'sleeper:league:12345',
          },
        ],
        coverage: {
          leagueSettings: { state: 'full' },
          currentRosters: { state: 'missing' },
          historicalRosterSnapshots: { state: 'missing' },
          scoringSettings: { state: 'partial' },
          playoffSettings: { state: 'partial' },
          currentStandings: { state: 'missing' },
          currentSchedule: { state: 'missing' },
          draftHistory: { state: 'missing' },
          tradeHistory: { state: 'missing' },
          previousSeasons: { state: 'missing' },
          playerIdentityMap: { state: 'missing' },
        },
      },
    })

    expect(leagueCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        platform: 'sleeper',
        platformLeagueId: '12345',
        importBatchId: 'sleeper-12345-batch',
        importedAt: new Date('2026-03-20T00:00:00.000Z'),
        settings: expect.objectContaining({
          source_tracking: expect.objectContaining({
            source_provider: 'sleeper',
            source_league_id: '12345',
            source_season_id: '2025',
          }),
          identity_mappings: expect.arrayContaining([
            expect.objectContaining({
              source_provider: 'sleeper',
              source_id: '12345',
              entity_type: 'league',
            }),
          ]),
        }),
      }),
    })
    expect(result.league).toEqual({
      id: 'league-abc',
      name: 'Imported League',
      sport: 'NFL',
    })
    expect(calculateAndSaveRankMock).toHaveBeenCalledWith('u1')
  })

  it('runs fantrax historical backfill for fantrax imports', async () => {
    leagueCreateMock.mockResolvedValue({
      id: 'league-fantrax',
      name: 'Fantrax League',
      sport: 'NCAAF',
    })

    const { persistImportedLeagueFromNormalization } = await import(
      '@/lib/league-import/ImportedLeagueCommitService'
    )

    const result = await persistImportedLeagueFromNormalization({
      userId: 'u1',
      provider: 'fantrax',
      normalized: {
        source: {
          source_provider: 'fantrax',
          source_league_id: 'fantrax-league-id',
          source_season_id: '2025',
          import_batch_id: 'fantrax-fantrax-league-id-batch',
          imported_at: '2026-03-21T00:00:00.000Z',
        },
        league: {
          name: 'Fantrax League',
          sport: 'NCAAF',
          season: 2025,
          leagueSize: 12,
          rosterSize: 20,
          scoring: 'devy',
          isDynasty: true,
        },
        rosters: [],
        scoring: null,
        schedule: [],
        draft_picks: [],
        transactions: [],
        standings: [],
        player_map: {},
        coverage: {
          leagueSettings: { state: 'full' },
          currentRosters: { state: 'missing' },
          historicalRosterSnapshots: { state: 'missing' },
          scoringSettings: { state: 'partial' },
          playoffSettings: { state: 'partial' },
          currentStandings: { state: 'missing' },
          currentSchedule: { state: 'missing' },
          draftHistory: { state: 'missing' },
          tradeHistory: { state: 'missing' },
          previousSeasons: { state: 'missing' },
          playerIdentityMap: { state: 'missing' },
        },
      },
    })

    await vi.waitFor(() => {
      expect(syncFantraxHistoricalBackfillAfterImportMock).toHaveBeenCalledWith({
        leagueId: 'league-fantrax',
        userId: 'u1',
      })
    })
    expect(result.historicalBackfill).toMatchObject({ status: 'pending' })
    expect(calculateAndSaveRankMock).toHaveBeenCalledWith('u1')
  })
})
