import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  requireVerifiedUserMock,
  runImportedLeagueNormalizationPipelineMock,
  buildCanonicalImportBundleMock,
  persistImportWithCanonicalAuditMock,
  assertImportCommissionerMock,
  recordImportAttestationMock,
  recordCommissionerVerificationMethodMock,
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
  recordCommissionerVerificationMethodMock: vi.fn(),
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
  recordCommissionerVerificationMethod: recordCommissionerVerificationMethodMock,
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
    recordCommissionerVerificationMethodMock.mockResolvedValue(undefined)
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

describe('POST /api/leagues/import/commit — Commissioner Import Attestation UI phase (audit evidence + rejection paths)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireVerifiedUserMock.mockResolvedValue({ ok: true, userId: 'af-user-1' })
    isImportProviderAvailableMock.mockReturnValue(true)
    resolveProviderMock.mockReturnValue('mfl')
    buildCanonicalImportBundleMock.mockReturnValue({ warnings: [], reviewRequired: false, reviewReasons: [] })
    recordImportAttestationMock.mockResolvedValue(undefined)
    recordCommissionerVerificationMethodMock.mockResolvedValue(undefined)
  })

  it('records both attestation and verification-method audit evidence, stamped with the real importRunId, after a successful attested commit', async () => {
    assertImportCommissionerMock.mockResolvedValue({ ok: true, verification: 'attestation', sourceManagerId: 'franchise-1' })
    persistImportWithCanonicalAuditMock.mockResolvedValue({
      persisted: { league: { id: 'league-mfl-1', name: 'MFL League', sport: 'NFL' }, historicalBackfill: null, existed: false },
      runId: 'run-real-1',
    })
    runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
      success: true,
      normalized: {
        source: { source_provider: 'mfl', source_league_id: '2026:12345', imported_at: new Date().toISOString() },
        league: { name: 'MFL League', season: 2026 },
      },
      rawPayload: {},
    })

    const { POST } = await import('@/app/api/leagues/import/commit/route')
    const res = await POST(
      makeRequest({
        provider: 'mfl',
        sourceId: '2026:12345',
        attestation: { accepted: true, statement: 'I run this league', confirmedProvider: 'mfl', confirmedSourceLeagueId: '2026:12345' },
      }) as any
    )
    expect(res.status).toBe(201)

    expect(recordImportAttestationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'league-mfl-1',
        appUserId: 'af-user-1',
        provider: 'mfl',
        sourceLeagueId: '2026:12345',
        attestation: { accepted: true, statement: 'I run this league' },
        importRunId: 'run-real-1',
      })
    )
    expect(recordCommissionerVerificationMethodMock).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'league-mfl-1',
        method: 'attestation',
        sourceManagerId: 'franchise-1',
        importRunId: 'run-real-1',
      })
    )
  })

  it('never calls either audit-evidence recorder when the gate rejects the commit (missing attestation)', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: false,
      requiresAttestation: true,
      reason: 'MFL cannot verify commissioner status automatically — confirm you are the league commissioner to continue.',
    })

    const { POST } = await import('@/app/api/leagues/import/commit/route')
    const res = await POST(makeRequest({ provider: 'mfl', sourceId: '2026:12345' }) as any)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('ATTESTATION_REQUIRED')
    expect(body.requiresAttestation).toBe(true)
    expect(persistImportWithCanonicalAuditMock).not.toHaveBeenCalled()
    expect(recordImportAttestationMock).not.toHaveBeenCalled()
    expect(recordCommissionerVerificationMethodMock).not.toHaveBeenCalled()
  })

  it('never calls either audit-evidence recorder when membership verification itself fails', async () => {
    assertImportCommissionerMock.mockResolvedValue({
      ok: false,
      reason: 'You are not a member of that MFL league according to your linked API key.',
    })

    const { POST } = await import('@/app/api/leagues/import/commit/route')
    const res = await POST(makeRequest({ provider: 'mfl', sourceId: '2026:12345' }) as any)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('NOT_COMMISSIONER')
    expect(persistImportWithCanonicalAuditMock).not.toHaveBeenCalled()
    expect(recordImportAttestationMock).not.toHaveBeenCalled()
  })

  it('never calls recordImportAttestation when normalization/commit fails after a passing gate — no partial evidence for a failed import', async () => {
    assertImportCommissionerMock.mockResolvedValue({ ok: true, verification: 'attestation' })
    runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
      success: false,
      error: 'Could not normalize league data',
      code: 'NORMALIZATION_FAILED',
    })

    const { POST } = await import('@/app/api/leagues/import/commit/route')
    const res = await POST(
      makeRequest({ provider: 'mfl', sourceId: '2026:12345', attestation: { accepted: true } }) as any
    )

    expect(res.status).toBe(422)
    expect(persistImportWithCanonicalAuditMock).not.toHaveBeenCalled()
    expect(recordImportAttestationMock).not.toHaveBeenCalled()
    expect(recordCommissionerVerificationMethodMock).not.toHaveBeenCalled()
  })

  it('passes the client-echoed confirmedProvider/confirmedSourceLeagueId through to assertImportCommissioner unmodified (server does its own comparison, does not trust them as authoritative)', async () => {
    assertImportCommissionerMock.mockResolvedValue({ ok: true, verification: 'attestation' })
    persistImportWithCanonicalAuditMock.mockResolvedValue({
      persisted: { league: { id: 'league-mfl-2', name: 'MFL League 2', sport: 'NFL' }, historicalBackfill: null, existed: false },
      runId: 'run-real-2',
    })
    runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
      success: true,
      normalized: {
        source: { source_provider: 'mfl', source_league_id: '2026:54321', imported_at: new Date().toISOString() },
        league: { name: 'MFL League 2', season: 2026 },
      },
      rawPayload: {},
    })

    const { POST } = await import('@/app/api/leagues/import/commit/route')
    await POST(
      makeRequest({
        provider: 'mfl',
        sourceId: '2026:54321',
        attestation: { accepted: true, confirmedProvider: 'mfl', confirmedSourceLeagueId: '2026:54321' },
      }) as any
    )

    expect(assertImportCommissionerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'mfl',
        sourceLeagueId: '2026:54321',
        attestation: expect.objectContaining({
          accepted: true,
          confirmedProvider: 'mfl',
          confirmedSourceLeagueId: '2026:54321',
        }),
      })
    )
  })

  it('a duplicate-import conflict (409) still records no new audit evidence and does not overwrite the existing league', async () => {
    assertImportCommissionerMock.mockResolvedValue({ ok: true, verification: 'attestation' })
    persistImportWithCanonicalAuditMock.mockRejectedValue(
      new ImportedLeagueConflictErrorMock('This league already exists in your account')
    )
    runImportedLeagueNormalizationPipelineMock.mockResolvedValue({
      success: true,
      normalized: {
        source: { source_provider: 'mfl', source_league_id: '2026:12345', imported_at: new Date().toISOString() },
        league: { name: 'MFL League', season: 2026 },
      },
      rawPayload: {},
    })

    const { POST } = await import('@/app/api/leagues/import/commit/route')
    const res = await POST(
      makeRequest({ provider: 'mfl', sourceId: '2026:12345', attestation: { accepted: true } }) as any
    )
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('LEAGUE_ALREADY_IMPORTED')
    expect(recordImportAttestationMock).not.toHaveBeenCalled()
    expect(recordCommissionerVerificationMethodMock).not.toHaveBeenCalled()
  })
})
