import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  requireVerifiedUserMock,
  runImportedLeagueNormalizationPipelineMock,
  buildCanonicalImportBundleMock,
  persistImportWithCanonicalAuditMock,
  assertImportCommissionerMock,
  recordImportAttestationMock,
  resolveProviderMock,
  isImportProviderAvailableMock,
  runSleeperImportValidationMock,
  toImportWarningRecordsMock,
} = vi.hoisted(() => ({
  requireVerifiedUserMock: vi.fn(),
  runImportedLeagueNormalizationPipelineMock: vi.fn(),
  buildCanonicalImportBundleMock: vi.fn(),
  persistImportWithCanonicalAuditMock: vi.fn(),
  assertImportCommissionerMock: vi.fn(),
  recordImportAttestationMock: vi.fn(),
  resolveProviderMock: vi.fn(),
  isImportProviderAvailableMock: vi.fn(),
  runSleeperImportValidationMock: vi.fn(),
  toImportWarningRecordsMock: vi.fn(),
}))

class ImportedLeagueConflictErrorMock extends Error {}

vi.mock('@/lib/auth-guard', () => ({ requireVerifiedUser: requireVerifiedUserMock }))
vi.mock('@/lib/league-import/ImportedLeagueNormalizationPipeline', () => ({
  runImportedLeagueNormalizationPipeline: runImportedLeagueNormalizationPipelineMock,
}))
vi.mock('@/lib/league-import/canonicalImportNormalizer', () => ({
  buildCanonicalImportBundle: buildCanonicalImportBundleMock,
}))
vi.mock('@/lib/league-import/ImportedLeagueCommitService', () => ({
  ImportedLeagueConflictError: ImportedLeagueConflictErrorMock,
}))
vi.mock('@/lib/league-import/importPersistenceService', () => ({
  persistImportWithCanonicalAudit: persistImportWithCanonicalAuditMock,
}))
vi.mock('@/lib/league-import/ImportProviderResolver', () => ({ resolveProvider: resolveProviderMock }))
vi.mock('@/lib/league-import/provider-ui-config', () => ({ isImportProviderAvailable: isImportProviderAvailableMock }))
vi.mock('@/lib/league-import/commissionerGate', () => ({
  assertImportCommissioner: assertImportCommissionerMock,
  recordImportAttestation: recordImportAttestationMock,
}))
vi.mock('@/lib/league-import/sleeper/SleeperImportValidation', () => ({
  runSleeperImportValidation: runSleeperImportValidationMock,
  toImportWarningRecords: toImportWarningRecordsMock,
}))

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/leagues/import/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/leagues/import/commit — validation wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'af-user-1' })
    isImportProviderAvailableMock.mockReturnValue(true)
    assertImportCommissionerMock.mockResolvedValue({ ok: true, verification: 'api' })
    buildCanonicalImportBundleMock.mockReturnValue({ warnings: [], reviewRequired: false, reviewReasons: [] })
    persistImportWithCanonicalAuditMock.mockResolvedValue({
      persisted: { league: { id: 'league-1', name: 'Test League', sport: 'NFL' }, historicalBackfill: null, existed: false },
      runId: 'run-1',
    })
    runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
      success: true,
      normalized: {
        source: { source_provider: 'sleeper', source_league_id: 'sleeper-1', imported_at: new Date().toISOString() },
        league: { name: 'Test League', season: 2026 },
      },
      rawPayload: { league: { league_id: 'sleeper-1' }, users: [{ user_id: 'sleeper-1' }] },
    })
  })

  it('runs Sleeper validation and passes mapped findings as additionalWarnings to persistence, without blocking the commit', async () => {
    resolveProviderMock.mockReturnValue('sleeper')
    const validationResult = {
      findings: [{ code: 'manager_identity_unlinked', severity: 'warn', message: 'not linked' }],
      isValid: true,
    }
    runSleeperImportValidationMock.mockResolvedValue(validationResult)
    const mappedWarnings = [{ code: 'sleeper_validation_manager_identity_unlinked', message: 'not linked', severity: 'warn' }]
    toImportWarningRecordsMock.mockReturnValue(mappedWarnings)

    const { POST } = await import('@/app/api/leagues/import/commit/route')
    const res = await POST(makeRequest({ provider: 'sleeper', sourceId: 'sleeper-1' }) as any)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(runSleeperImportValidationMock).toHaveBeenCalledWith(
      { league: { league_id: 'sleeper-1' }, users: [{ user_id: 'sleeper-1' }] },
      'af-user-1'
    )
    expect(persistImportWithCanonicalAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ additionalWarnings: mappedWarnings })
    )
    expect(body.validation).toEqual(validationResult)
  })

  it('never blocks the commit even when validation reports error-severity findings', async () => {
    resolveProviderMock.mockReturnValue('sleeper')
    runSleeperImportValidationMock.mockResolvedValue({
      findings: [{ code: 'rosters_missing', severity: 'error', message: 'no rosters' }],
      isValid: false,
    })
    toImportWarningRecordsMock.mockReturnValue([])

    const { POST } = await import('@/app/api/leagues/import/commit/route')
    const res = await POST(makeRequest({ provider: 'sleeper', sourceId: 'sleeper-1' }) as any)

    expect(res.status).toBe(201)
    expect(persistImportWithCanonicalAuditMock).toHaveBeenCalled()
  })

  it('never blocks the commit even when the validation call itself throws', async () => {
    resolveProviderMock.mockReturnValue('sleeper')
    runSleeperImportValidationMock.mockRejectedValue(new Error('identity service unavailable'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { POST } = await import('@/app/api/leagues/import/commit/route')
    const res = await POST(makeRequest({ provider: 'sleeper', sourceId: 'sleeper-1' }) as any)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.validation).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    expect(persistImportWithCanonicalAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ additionalWarnings: undefined })
    )
  })

  it('does not run Sleeper validation at all for a non-Sleeper provider', async () => {
    resolveProviderMock.mockReturnValue('espn')
    runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
      success: true,
      normalized: {
        source: { source_provider: 'espn', source_league_id: 'espn-1', imported_at: new Date().toISOString() },
        league: { name: 'ESPN League', season: 2026 },
      },
      rawPayload: { league: {} },
    })

    const { POST } = await import('@/app/api/leagues/import/commit/route')
    const res = await POST(makeRequest({ provider: 'espn', sourceId: 'espn-1' }) as any)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(runSleeperImportValidationMock).not.toHaveBeenCalled()
    expect(body.validation).toBeUndefined()
    expect(persistImportWithCanonicalAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ additionalWarnings: undefined })
    )
  })
})
