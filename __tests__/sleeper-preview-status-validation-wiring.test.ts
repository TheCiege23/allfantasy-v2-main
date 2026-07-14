import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedImportResult } from '@/lib/league-import/types'

const {
  getServerSessionMock,
  runImportedLeagueNormalizationPipelineMock,
  buildImportedLeaguePreviewMock,
  buildSleeperImportStatusReportMock,
  runSleeperImportValidationMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  runImportedLeagueNormalizationPipelineMock: vi.fn(),
  buildImportedLeaguePreviewMock: vi.fn(),
  buildSleeperImportStatusReportMock: vi.fn(),
  runSleeperImportValidationMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-import/ImportedLeagueNormalizationPipeline', () => ({
  runImportedLeagueNormalizationPipeline: runImportedLeagueNormalizationPipelineMock,
}))
vi.mock('@/lib/league-import/ImportedLeaguePreviewBuilder', () => ({
  buildImportedLeaguePreview: buildImportedLeaguePreviewMock,
}))
vi.mock('@/lib/league-import/sleeper/SleeperImportStatusReport', () => ({
  buildSleeperImportStatusReport: buildSleeperImportStatusReportMock,
}))
vi.mock('@/lib/league-import/sleeper/SleeperImportValidation', () => ({
  runSleeperImportValidation: runSleeperImportValidationMock,
}))

function normalized(overrides: Partial<NormalizedImportResult> = {}): NormalizedImportResult {
  return {
    source: { source_provider: 'sleeper', source_league_id: 'league-1', imported_at: new Date().toISOString() },
    league: { name: 'Test League', sport: 'NFL', season: 2026, leagueSize: 10, rosterSize: null, scoring: null, isDynasty: false },
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
      historicalRosterSnapshots: { state: 'missing' },
      scoringSettings: { state: 'full' },
      playoffSettings: { state: 'full' },
      currentStandings: { state: 'full' },
      currentSchedule: { state: 'full' },
      draftHistory: { state: 'full' },
      tradeHistory: { state: 'full' },
      previousSeasons: { state: 'missing' },
      playerIdentityMap: { state: 'full' },
    },
    ...overrides,
  } as NormalizedImportResult
}

function makeRequest(leagueId: string) {
  return new Request('http://localhost/api/league/import/sleeper/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leagueId }),
  })
}

describe('POST /api/league/import/sleeper/preview — status/validation wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'af-user-1' } })
    buildImportedLeaguePreviewMock.mockReturnValue({ league: { id: 'league-1', name: 'Test League' } })
  })

  it('threads the session userId through to the normalization pipeline as the object form', async () => {
    runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
      success: true,
      normalized: normalized(),
      rawPayload: { league: { league_id: 'league-1' }, users: [] },
    })
    buildSleeperImportStatusReportMock.mockReturnValue({ provider: 'sleeper', fetchedAt: null, isStale: false, hasFailures: false, fields: [] })
    runSleeperImportValidationMock.mockResolvedValue({ findings: [], isValid: true })

    const { POST } = await import('@/app/api/league/import/sleeper/preview/route')
    await POST(makeRequest('league-1') as any)

    expect(runImportedLeagueNormalizationPipelineMock).toHaveBeenCalledWith({
      provider: 'sleeper',
      sourceId: 'league-1',
      userId: 'af-user-1',
    })
  })

  it('attaches importStatus and validation to the preview response', async () => {
    runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
      success: true,
      normalized: normalized(),
      rawPayload: { league: { league_id: 'league-1' }, users: [] },
    })
    const statusReport = { provider: 'sleeper', fetchedAt: '2026-07-09T00:00:00.000Z', isStale: false, hasFailures: false, fields: [] }
    const validationResult = { findings: [], isValid: true }
    buildSleeperImportStatusReportMock.mockReturnValue(statusReport)
    runSleeperImportValidationMock.mockResolvedValue(validationResult)

    const { POST } = await import('@/app/api/league/import/sleeper/preview/route')
    const res = await POST(makeRequest('league-1') as any)
    const body = await res.json()

    expect(body.importStatus).toEqual(statusReport)
    expect(body.validation).toEqual(validationResult)
    expect(body.league).toEqual({ id: 'league-1', name: 'Test League' })
  })

  it('regression: a partial import (fetch failures present) still returns 200 with an honest, non-blocking status', async () => {
    runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
      success: true,
      normalized: normalized({
        fetch_warnings: [
          { code: 'sleeper_fetch_incomplete_transactions', message: 'boom', severity: 'warn', metadata: { field: 'transactions' } },
        ],
      }),
      rawPayload: { league: { league_id: 'league-1' }, users: [] },
    })
    buildSleeperImportStatusReportMock.mockReturnValue({
      provider: 'sleeper',
      fetchedAt: null,
      isStale: false,
      hasFailures: true,
      fields: [{ field: 'tradeHistory', status: 'failed', provider: 'sleeper', fetchedAt: null, note: null }],
    })
    runSleeperImportValidationMock.mockResolvedValue({
      findings: [{ code: 'transactions_unavailable', severity: 'info', message: 'no transactions' }],
      isValid: true,
    })

    const { POST } = await import('@/app/api/league/import/sleeper/preview/route')
    const res = await POST(makeRequest('league-1') as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.importStatus.hasFailures).toBe(true)
    expect(body.league).toBeDefined() // the preview itself is never blocked by a partial/failed category
  })

  it('never lets a status/validation reporting failure break the preview response', async () => {
    runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
      success: true,
      normalized: normalized(),
      rawPayload: { league: { league_id: 'league-1' }, users: [] },
    })
    buildSleeperImportStatusReportMock.mockImplementation(() => {
      throw new Error('reporting exploded')
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { POST } = await import('@/app/api/league/import/sleeper/preview/route')
    const res = await POST(makeRequest('league-1') as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.league).toEqual({ id: 'league-1', name: 'Test League' })
    expect(body.importStatus).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('returns the underlying error status when normalization itself fails', async () => {
    runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
      success: false,
      error: 'League not found. Please check your League ID.',
      code: 'LEAGUE_NOT_FOUND',
    })

    const { POST } = await import('@/app/api/league/import/sleeper/preview/route')
    const res = await POST(makeRequest('does-not-exist') as any)

    expect(res.status).toBe(404)
    expect(buildSleeperImportStatusReportMock).not.toHaveBeenCalled()
  })
})
