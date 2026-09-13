import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getServerSessionMock,
  requireVerifiedUserMock,
  assertImportCommissionerMock,
  runImportedLeagueNormalizationPipelineMock,
  buildCanonicalImportBundleMock,
  persistImportWithCanonicalAuditMock,
  leagueFindFirstMock,
  leagueCreateMock,
  leagueFindUniqueMock,
  leagueWaiverSettingsFindUniqueMock,
  leagueWaiverSettingsUpsertMock,
  trackMetaServerEventMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  requireVerifiedUserMock: vi.fn(),
  assertImportCommissionerMock: vi.fn(),
  runImportedLeagueNormalizationPipelineMock: vi.fn(),
  buildCanonicalImportBundleMock: vi.fn(() => ({
    inferredConcept: 'dynasty',
    inferredLeagueType: 'dynasty',
    scoringPresetId: 'fb_half_ppr',
    draftType: 'snake',
    presetKey: 'test-preset',
    leagueTypeColumn: 'dynasty',
    derivedFlags: {
      idp: false,
      salaryCap: false,
      devy: false,
      c2c: false,
      bestBall: false,
      dynasty: true,
      tournament: false,
    },
    importMetadata: {
      importSource: 'sleeper',
      externalLeagueId: '12345',
      normalizedAt: new Date().toISOString(),
      normalizationVersion: '2',
    },
    warnings: [],
    reviewRequired: false,
    reviewReasons: [],
    settingsSnapshot: { snapshotVersion: 1 },
    meta: { provider: 'sleeper', sourceLeagueId: '12345', confidence: {} },
  })),
  persistImportWithCanonicalAuditMock: vi.fn(),
  leagueFindFirstMock: vi.fn(),
  leagueCreateMock: vi.fn(),
  leagueFindUniqueMock: vi.fn(),
  leagueWaiverSettingsFindUniqueMock: vi.fn(),
  leagueWaiverSettingsUpsertMock: vi.fn(),
  trackMetaServerEventMock: vi.fn(),
}))

class ImportedLeagueConflictErrorMock extends Error {}

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/auth-guard', () => ({
  requireVerifiedUser: requireVerifiedUserMock,
}))

vi.mock('@/lib/league-import/commissionerGate', () => ({
  assertImportCommissioner: assertImportCommissionerMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findFirst: leagueFindFirstMock,
      findUnique: leagueFindUniqueMock,
      create: leagueCreateMock,
    },
    leagueWaiverSettings: {
      findUnique: leagueWaiverSettingsFindUniqueMock,
      upsert: leagueWaiverSettingsUpsertMock,
    },
  },
}))

vi.mock('@/lib/viral-loop', () => ({
  buildLeagueInviteUrl: vi.fn(() => 'https://invite.test/league'),
}))

/*
 * 🛑 THIS SUITE MUST NEVER SEND A REAL META CONVERSION.
 *
 * Creating a league fires a Meta "Lead" through `trackMetaServerEvent`, and a conversion that
 * reaches Meta cannot be taken back: it trains the ad optimiser on a person who does not exist.
 * Before this mock the only thing stopping that was `META_CONVERSIONS_API_TOKEN` happening to be
 * unset in the test environment — the run logged "not set, skipping CAPI event". That is luck,
 * not a guard, and it ends the day someone exports the token in a shell or the env loading
 * changes. Only the sender is replaced; the rest of the module stays real.
 */
vi.mock('@/lib/meta-capi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/meta-capi')>()),
  trackMetaServerEvent: trackMetaServerEventMock,
}))

vi.mock('@/lib/league-import/ImportedLeagueNormalizationPipeline', () => ({
  runImportedLeagueNormalizationPipeline: runImportedLeagueNormalizationPipelineMock,
}))

vi.mock('@/lib/league-import/canonicalImportNormalizer', () => ({
  buildCanonicalImportBundle: buildCanonicalImportBundleMock,
}))

vi.mock('@/lib/league-import/importPersistenceService', () => ({
  persistImportWithCanonicalAudit: persistImportWithCanonicalAuditMock,
  // A real class, not vi.fn(): the commit route narrows with
  // `error instanceof ImportRunInFlightError` (app/api/leagues/import/commit/route.ts).
  ImportRunInFlightError: class ImportRunInFlightError extends Error {},
}))

vi.mock('@/lib/league-import/ImportedLeagueCommitService', () => ({
  ImportedLeagueConflictError: ImportedLeagueConflictErrorMock,
}))

describe('POST /api/league/create Sleeper import flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The route chains `.catch` on this, so it must return a promise.
    trackMetaServerEventMock.mockResolvedValue({ success: true })
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    requireVerifiedUserMock.mockResolvedValue({
      ok: true,
      userId: 'u1',
    })
    assertImportCommissionerMock.mockResolvedValue({ ok: true, sourceManagerId: 'sleeper-user-1' })
    leagueFindFirstMock.mockResolvedValue(null)
    leagueFindUniqueMock.mockResolvedValue({ sport: 'NFL', leagueVariant: null })
    leagueWaiverSettingsFindUniqueMock.mockResolvedValue(null)
    leagueWaiverSettingsUpsertMock.mockResolvedValue({ id: 'lws-1' })
    leagueCreateMock.mockResolvedValue({
      id: 'league-1',
      name: 'Imported Sleeper League',
      sport: 'NFL',
    })
  })

  it('creates league from Sleeper import during league creation', async () => {
    runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
      success: true,
      normalized: {
        source: {
          source_provider: 'sleeper',
          source_league_id: '12345',
          source_season_id: '2025',
          import_batch_id: 'sleeper-12345-batch',
          imported_at: '2026-03-20T00:00:00.000Z',
        },
        league: {
          name: 'Imported Sleeper League',
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
        coverage: {
          leagueSettings: { state: 'full' },
          currentRosters: { state: 'full' },
          historicalRosterSnapshots: { state: 'partial' },
          scoringSettings: { state: 'full' },
          playoffSettings: { state: 'full' },
          currentStandings: { state: 'full' },
          currentSchedule: { state: 'partial' },
          draftHistory: { state: 'partial' },
          tradeHistory: { state: 'partial' },
          previousSeasons: { state: 'partial' },
          playerIdentityMap: { state: 'partial' },
        },
      },
    })
    persistImportWithCanonicalAuditMock.mockResolvedValue({
      persisted: {
        league: { id: 'league-1', name: 'Imported Sleeper League', sport: 'NFL' },
        historicalBackfill: { status: 'queued' },
        existed: false,
      },
      runId: 'run-1',
    })

    const { POST } = await import('@/app/api/league/create/route')
    const req = new Request('http://localhost/api/league/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'sleeper',
        createFromSleeperImport: true,
        sleeperLeagueId: '12345',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      league: { id: 'league-1', name: 'Imported Sleeper League', sport: 'NFL' },
      historicalBackfill: { status: 'queued' },
      importRunId: 'run-1',
      /*
       * Returned on purpose since b9033d3c8 (2026-06-05). The league-creation screens hand this
       * response to `trackMetaEventsFromResponse`, which fires the browser pixel with the SAME
       * deterministic `eventId` the server sent, so Meta counts one Lead rather than two. It carries
       * the caller's own league name and id and nothing about the user.
       */
      metaEvent: {
        eventName: 'Lead',
        eventId: 'af_Lead_fantasy_league:league-1',
        customData: {
          content_name: 'Imported Sleeper League',
          content_category: 'Fantasy League',
          content_ids: ['league-1'],
          value: 0,
          currency: 'USD',
          league_id: 'league-1',
          sport: 'NFL',
          league_type: 'imported',
          draft_type: null,
        },
      },
    })

    /*
     * The dedupe only works if the server event and the returned one share an id, so pin that
     * here rather than trusting two builders to agree.
     */
    expect(trackMetaServerEventMock).toHaveBeenCalledTimes(1)
    expect(trackMetaServerEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'Lead',
        eventId: 'af_Lead_fantasy_league:league-1',
        userId: 'u1',
        source: 'sleeper_import_league_create',
      }),
    )

    expect(runImportedLeagueNormalizationPipelineMock).toHaveBeenCalledWith({
      provider: 'sleeper',
      sourceId: '12345',
      userId: 'u1',
    })
    expect(persistImportWithCanonicalAuditMock).toHaveBeenCalledWith({
      userId: 'u1',
      provider: 'sleeper',
      normalized: expect.objectContaining({
        source: expect.objectContaining({
          source_provider: 'sleeper',
          source_league_id: '12345',
          import_batch_id: 'sleeper-12345-batch',
          imported_at: '2026-03-20T00:00:00.000Z',
        }),
      }),
      canonical: expect.any(Object),
      allowUpdateExisting: false,
    })
    expect(assertImportCommissionerMock).toHaveBeenCalledWith({
      appUserId: 'u1',
      provider: 'sleeper',
      sourceLeagueId: '12345',
    })
  })

  it('maps Sleeper import conflicts to 409', async () => {
    runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
      success: true,
      normalized: {
        source: {
          source_provider: 'sleeper',
          source_league_id: '12345',
          imported_at: '2026-03-20T00:00:00.000Z',
        },
        league: {
          name: 'Imported Sleeper League',
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
        coverage: {
          leagueSettings: { state: 'full' },
          currentRosters: { state: 'full' },
          historicalRosterSnapshots: { state: 'partial' },
          scoringSettings: { state: 'full' },
          playoffSettings: { state: 'full' },
          currentStandings: { state: 'full' },
          currentSchedule: { state: 'partial' },
          draftHistory: { state: 'partial' },
          tradeHistory: { state: 'partial' },
          previousSeasons: { state: 'partial' },
          playerIdentityMap: { state: 'partial' },
        },
      },
    })
    persistImportWithCanonicalAuditMock.mockRejectedValue(
      new ImportedLeagueConflictErrorMock('This league already exists in your account')
    )

    const { POST } = await import('@/app/api/league/create/route')
    const req = new Request('http://localhost/api/league/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'sleeper',
        createFromSleeperImport: true,
        sleeperLeagueId: '12345',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({
      error: 'This league already exists in your account',
    })
  })

  it('blocks Sleeper import when the user is not commissioner', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: false,
      reason: 'Only the commissioner or a co-commissioner can import this Sleeper league.',
    })

    const { POST } = await import('@/app/api/league/create/route')
    const req = new Request('http://localhost/api/league/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'sleeper',
        createFromSleeperImport: true,
        sleeperLeagueId: '12345',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({
      error: 'Only the commissioner or a co-commissioner can import this Sleeper league.',
    })
    expect(runImportedLeagueNormalizationPipelineMock).not.toHaveBeenCalled()
  })
})
