import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  importRunFindUnique,
  importRunCreate,
  importRunUpdate,
  importWarningCreate,
  externalEntityMappingUpsert,
  persistImportedLeagueFromNormalizationMock,
} = vi.hoisted(() => ({
  importRunFindUnique: vi.fn(),
  importRunCreate: vi.fn(),
  importRunUpdate: vi.fn(),
  importWarningCreate: vi.fn(),
  externalEntityMappingUpsert: vi.fn(),
  persistImportedLeagueFromNormalizationMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    importRun: { findUnique: importRunFindUnique, create: importRunCreate, update: importRunUpdate },
    importWarning: { create: importWarningCreate },
    externalEntityMapping: { upsert: externalEntityMappingUpsert },
    league: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/league-import/ImportedLeagueCommitService', () => ({
  persistImportedLeagueFromNormalization: persistImportedLeagueFromNormalizationMock,
}))

function baseNormalized() {
  return {
    source: { source_provider: 'sleeper' as const, source_league_id: 'league-1', imported_at: new Date().toISOString() },
    league: { name: 'Test League', season: 2026 },
    identity_mappings: [],
  }
}

describe('persistImportWithCanonicalAudit — additionalWarnings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    importRunFindUnique.mockResolvedValue(null)
    importRunCreate.mockResolvedValue({ id: 'run-1' })
    persistImportedLeagueFromNormalizationMock.mockResolvedValue({
      league: { id: 'league-db-1', name: 'Test League', sport: 'NFL' },
      historicalBackfill: null,
      existed: false,
    })
  })

  it('persists only canonical warnings when additionalWarnings is omitted (backward compatible)', async () => {
    const { persistImportWithCanonicalAudit } = await import('@/lib/league-import/importPersistenceService')

    await persistImportWithCanonicalAudit({
      userId: 'u1',
      provider: 'sleeper',
      normalized: baseNormalized() as any,
      canonical: {
        warnings: [{ code: 'coverage_draftHistory', message: 'missing', severity: 'info' }],
        reviewRequired: false,
        reviewReasons: [],
      } as any,
    })

    expect(importWarningCreate).toHaveBeenCalledTimes(1)
    expect(importWarningCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: 'coverage_draftHistory' }) })
    )
  })

  it('persists both canonical warnings and additionalWarnings when supplied', async () => {
    const { persistImportWithCanonicalAudit } = await import('@/lib/league-import/importPersistenceService')

    await persistImportWithCanonicalAudit({
      userId: 'u1',
      provider: 'sleeper',
      normalized: baseNormalized() as any,
      canonical: {
        warnings: [{ code: 'coverage_draftHistory', message: 'missing', severity: 'info' }],
        reviewRequired: false,
        reviewReasons: [],
      } as any,
      additionalWarnings: [
        { code: 'sleeper_validation_manager_identity_unlinked', message: 'not linked', severity: 'warn' },
      ],
    })

    expect(importWarningCreate).toHaveBeenCalledTimes(2)
    const persistedCodes = importWarningCreate.mock.calls.map((call) => call[0].data.code)
    expect(persistedCodes).toEqual(
      expect.arrayContaining(['coverage_draftHistory', 'sleeper_validation_manager_identity_unlinked'])
    )
  })
})

describe('recordCanonicalImportAuditForExistingLeague — additionalWarnings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    importRunFindUnique.mockResolvedValue(null)
    importRunCreate.mockResolvedValue({ id: 'run-2' })
  })

  it('persists both canonical warnings and additionalWarnings when supplied', async () => {
    const { recordCanonicalImportAuditForExistingLeague } = await import(
      '@/lib/league-import/importPersistenceService'
    )

    await recordCanonicalImportAuditForExistingLeague({
      userId: 'u1',
      leagueId: 'league-db-1',
      provider: 'sleeper',
      normalized: baseNormalized() as any,
      canonical: { warnings: [], reviewRequired: false, reviewReasons: [] } as any,
      additionalWarnings: [
        { code: 'sleeper_validation_rosters_missing', message: 'no rosters', severity: 'error' },
      ],
    })

    expect(importWarningCreate).toHaveBeenCalledTimes(1)
    expect(importWarningCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ code: 'sleeper_validation_rosters_missing', severity: 'error' }),
      })
    )
  })
})
