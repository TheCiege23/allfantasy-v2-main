import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireVerifiedUserMock = vi.fn()
const runImportedLeagueNormalizationPipelineMock = vi.fn()
const buildImportedLeaguePreviewMock = vi.fn()
const persistImportWithCanonicalAuditMock = vi.fn()

class ImportedLeagueConflictErrorMock extends Error {}

vi.mock('@/lib/auth-guard', () => ({
  requireVerifiedUser: requireVerifiedUserMock,
}))

/*
 * ⚠ THE COMMIT ROUTE GREW A COMMISSIONER GATE AND THIS FILE NEVER SAW IT. Phase
 * 2.2 made a full-league commit commissioner-only via `assertImportCommissioner`
 * with `requireCommissioner: true`. For a provider that CANNOT determine
 * commissioner status — which is Fantrax and MFL — the documented outcome is
 * `isCommissioner === undefined` plus proven membership, so the gate demands a
 * recorded attestation. Unmocked, it ran for real here and answered 403
 * ATTESTATION_REQUIRED to all four commit cases, which is the gate working.
 *
 * These four tests are about the commit route's ERROR MAPPING — which
 * normalization failure becomes 404, 401, 409 or 200. The gate is a separate
 * concern with its own coverage; leaving it live only means every case 403s
 * before reaching the mapping under test.
 *
 * Spread from importOriginal so the module's other exports stay real and this
 * mock cannot rot the way the world-cup one did when its module gained an export.
 */
vi.mock('@/lib/league-import/commissionerGate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/league-import/commissionerGate')>()),
  assertImportCommissioner: vi.fn(async () => ({ ok: true as const })),
}))

vi.mock('@/lib/league-import/ImportedLeagueNormalizationPipeline', () => ({
  runImportedLeagueNormalizationPipeline: runImportedLeagueNormalizationPipelineMock,
}))

vi.mock('@/lib/league-import/ImportedLeaguePreviewBuilder', () => ({
  buildImportedLeaguePreview: buildImportedLeaguePreviewMock,
}))

vi.mock('@/lib/league-import/ImportedLeagueCommitService', () => ({
  ImportedLeagueConflictError: ImportedLeagueConflictErrorMock,
}))

vi.mock('@/lib/league-import/importPersistenceService', () => ({
  persistImportWithCanonicalAudit: persistImportWithCanonicalAuditMock,
}))

describe('Fantrax import API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireVerifiedUserMock.mockResolvedValue({
      ok: true,
      userId: 'u1',
    })
  })

  describe('POST /api/leagues/import/preview', () => {
    it('returns preview for fantrax import success', async () => {
      runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
        success: true,
        normalized: {
          source: {
            source_provider: 'fantrax',
            source_league_id: 'fantrax-league-1',
            imported_at: new Date().toISOString(),
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
            currentRosters: { state: 'partial' },
            historicalRosterSnapshots: { state: 'partial' },
            scoringSettings: { state: 'partial' },
            playoffSettings: { state: 'partial' },
            currentStandings: { state: 'partial' },
            currentSchedule: { state: 'partial' },
            draftHistory: { state: 'partial' },
            tradeHistory: { state: 'partial' },
            previousSeasons: { state: 'partial' },
            playerIdentityMap: { state: 'partial' },
          },
        },
      })
      buildImportedLeaguePreviewMock.mockReturnValue({
        league: { id: 'fantrax-league-1', name: 'Fantrax League' },
      })

      const { POST } = await import('@/app/api/leagues/import/preview/route')
      const req = new Request('http://localhost/api/leagues/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'Fantrax',
          sourceId: ' id:fantrax-league-1 ',
        }),
      })

      const res = await POST(req as any)
      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toMatchObject({
        league: { id: 'fantrax-league-1', name: 'Fantrax League' },
      })
      expect(runImportedLeagueNormalizationPipelineMock).toHaveBeenCalledWith({
        provider: 'fantrax',
        sourceId: 'id:fantrax-league-1',
        userId: 'u1',
      })
    })

    it('maps fantrax league-not-found normalization errors to 404', async () => {
      runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
        success: false,
        error: 'Fantrax league not found.',
        code: 'LEAGUE_NOT_FOUND',
      })

      const { POST } = await import('@/app/api/leagues/import/preview/route')
      const req = new Request('http://localhost/api/leagues/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'fantrax',
          sourceId: 'id:missing',
        }),
      })

      const res = await POST(req as any)
      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toEqual({ error: 'Fantrax league not found.' })
    })

    it('maps fantrax unauthorized normalization errors to 401', async () => {
      runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
        success: false,
        error: 'Sign in before importing from Fantrax.',
        code: 'UNAUTHORIZED',
      })

      const { POST } = await import('@/app/api/leagues/import/preview/route')
      const req = new Request('http://localhost/api/leagues/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'fantrax',
          sourceId: 'id:private-league',
        }),
      })

      const res = await POST(req as any)
      expect(res.status).toBe(401)
      await expect(res.json()).resolves.toEqual({ error: 'Sign in before importing from Fantrax.' })
    })
  })

  describe('POST /api/leagues/import/commit', () => {
    it('commits fantrax import and returns created league payload', async () => {
      runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
        success: true,
        normalized: {
          source: {
            source_provider: 'fantrax',
            source_league_id: 'fantrax-league-2',
            imported_at: new Date().toISOString(),
          },
          league: {
            name: 'Fantrax Commit League',
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
            currentRosters: { state: 'partial' },
            historicalRosterSnapshots: { state: 'partial' },
            scoringSettings: { state: 'partial' },
            playoffSettings: { state: 'partial' },
            currentStandings: { state: 'partial' },
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
          league: {
            id: 'league-new',
            name: 'Fantrax Commit League',
            sport: 'NCAAF',
          },
          historicalBackfill: { status: 'queued' },
          existed: false,
        },
        runId: 'import-run-1',
      })

      const { POST } = await import('@/app/api/leagues/import/commit/route')
      const req = new Request('http://localhost/api/leagues/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'fantrax',
          sourceId: 'id:fantrax-league-2',
        }),
      })

      const res = await POST(req as any)
      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toEqual({
        leagueId: 'league-new',
        name: 'Fantrax Commit League',
        sport: 'NCAAF',
        league: {
          id: 'league-new',
          name: 'Fantrax Commit League',
          sport: 'NCAAF',
        },
        historicalBackfill: { status: 'queued' },
        importRunId: 'import-run-1',
        /*
         * ⚠ ADDED DELIBERATELY, AND FOR A MEASURED REASON — a `toEqual` here is
         * exact, so a new field fails the test rather than being ignored.
         * `persistImportWithCanonicalAudit` short-circuits on the idempotency
         * key, so a previously-completed run returned 200 with no way to tell it
         * from a fresh import; a bulk run over 55 discovered leagues reported
         * every one as "Imported". `existed` and `skipped` are what let a caller
         * tell those apart, so they belong in the asserted contract.
         */
        existed: false,
        skipped: false,
      })
      expect(persistImportWithCanonicalAuditMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          provider: 'fantrax',
          allowUpdateExisting: false,
        })
      )
    })

    it('maps fantrax league-not-found normalization errors to 404', async () => {
      runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
        success: false,
        error: 'Fantrax league not found.',
        code: 'LEAGUE_NOT_FOUND',
      })

      const { POST } = await import('@/app/api/leagues/import/commit/route')
      const req = new Request('http://localhost/api/leagues/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'fantrax',
          sourceId: 'id:missing',
        }),
      })

      const res = await POST(req as any)
      expect(res.status).toBe(404)
      await expect(res.json()).resolves.toEqual({ error: 'Fantrax league not found.' })
    })

    it('maps fantrax unauthorized normalization errors to 401', async () => {
      runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
        success: false,
        error: 'Sign in before importing from Fantrax.',
        code: 'UNAUTHORIZED',
      })

      const { POST } = await import('@/app/api/leagues/import/commit/route')
      const req = new Request('http://localhost/api/leagues/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'fantrax',
          sourceId: 'id:private-league',
        }),
      })

      const res = await POST(req as any)
      expect(res.status).toBe(401)
      await expect(res.json()).resolves.toEqual({ error: 'Sign in before importing from Fantrax.' })
    })

    it('maps fantrax imported league conflict to 409', async () => {
      runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
        success: true,
        normalized: {
          source: {
            source_provider: 'fantrax',
            source_league_id: 'fantrax-league-existing',
            imported_at: new Date().toISOString(),
          },
          league: {
            name: 'Existing Fantrax League',
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
            currentRosters: { state: 'partial' },
            historicalRosterSnapshots: { state: 'partial' },
            scoringSettings: { state: 'partial' },
            playoffSettings: { state: 'partial' },
            currentStandings: { state: 'partial' },
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

      const { POST } = await import('@/app/api/leagues/import/commit/route')
      const req = new Request('http://localhost/api/leagues/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'fantrax',
          sourceId: 'id:fantrax-league-existing',
        }),
      })

      const res = await POST(req as any)
      expect(res.status).toBe(409)
      await expect(res.json()).resolves.toMatchObject({
        error: 'This league already exists in your account',
        code: 'LEAGUE_ALREADY_IMPORTED',
      })
    })
  })
})
