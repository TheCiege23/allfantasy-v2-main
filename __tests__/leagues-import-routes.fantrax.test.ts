import { beforeEach, describe, expect, it, vi } from 'vitest'

const requireVerifiedUserMock = vi.fn()
const runImportedLeagueNormalizationPipelineMock = vi.fn()
const buildImportedLeaguePreviewMock = vi.fn()
const persistImportWithCanonicalAuditMock = vi.fn()

class ImportedLeagueConflictErrorMock extends Error {}

vi.mock('@/lib/auth-guard', () => ({
  requireVerifiedUser: requireVerifiedUserMock,
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
      expect(res.status).toBe(201)
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
        replayed: false,
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
