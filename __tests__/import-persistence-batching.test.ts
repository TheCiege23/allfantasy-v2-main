import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  importRunFindUnique: vi.fn(),
  importRunFindUniqueOrThrow: vi.fn(),
  importRunCreate: vi.fn(),
  importRunUpdate: vi.fn(),
  importRunUpdateMany: vi.fn(),
  leagueFindUnique: vi.fn(),
  persistImported: vi.fn(),
  warningDeleteMany: vi.fn(),
  warningCreateMany: vi.fn(),
  reviewDeleteMany: vi.fn(),
  reviewCreate: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  startAttempt: vi.fn(),
  finishAttempt: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    importRun: {
      findUnique: h.importRunFindUnique,
      findUniqueOrThrow: h.importRunFindUniqueOrThrow,
      create: h.importRunCreate,
      update: h.importRunUpdate,
      updateMany: h.importRunUpdateMany,
    },
    league: { findUnique: h.leagueFindUnique },
    importReviewTask: {
      deleteMany: h.reviewDeleteMany,
      create: h.reviewCreate,
    },
    $executeRaw: h.executeRaw,
    $transaction: h.transaction,
  },
}))

vi.mock('@/lib/league-import/importRunAttempts', () => ({
  startImportAttempt: h.startAttempt,
  finishImportAttempt: h.finishAttempt,
}))

vi.mock('@/lib/league-import/ImportedLeagueCommitService', () => ({
  persistImportedLeagueFromNormalization: h.persistImported,
}))

import { ImportRunInFlightError, persistImportWithCanonicalAudit, recordCanonicalImportAuditForExistingLeague } from '@/lib/league-import/importPersistenceService'

describe('import persistence batching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.importRunFindUnique.mockResolvedValue(null)
    h.importRunCreate.mockResolvedValue({ id: 'run-1', rawPayloadHash: 'hash-1' })
    h.importRunFindUniqueOrThrow.mockResolvedValue({ id: 'run-1', rawPayloadHash: 'hash-1' })
    h.importRunUpdate.mockResolvedValue({})
    h.importRunUpdateMany.mockResolvedValue({ count: 1 })
    h.leagueFindUnique.mockResolvedValue(null)
    h.persistImported.mockResolvedValue({
      league: { id: 'league-1', name: 'Restored league', sport: 'NFL' },
      incompleteSteps: [], joinedExisting: false,
    })
    h.startAttempt.mockResolvedValue('attempt-1')
    h.finishAttempt.mockResolvedValue(undefined)
    h.warningDeleteMany.mockResolvedValue({ count: 0 })
    h.warningCreateMany.mockResolvedValue({ count: 2 })
    h.reviewDeleteMany.mockResolvedValue({ count: 0 })
    h.executeRaw.mockResolvedValue(1)
    h.transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        importWarning: {
          deleteMany: h.warningDeleteMany,
          createMany: h.warningCreateMany,
        },
      }),
    )
  })

  it('writes warnings once and 501 unique mappings in three bounded database calls', async () => {
    const mappings = Array.from({ length: 501 }, (_, index) => ({
      source_provider: 'sleeper' as const,
      source_id: `player-${index}`,
      entity_type: 'player' as const,
      af_id: index % 2 === 0 ? `af-${index}` : null,
      stable_key: `player:${index}`,
    }))

    // A repeated source key is common when provider payloads overlap. Last-write semantics
    // are preserved, but the duplicate should not cost another database operation.
    mappings.push({
      source_provider: 'sleeper',
      source_id: 'player-0',
      entity_type: 'player',
      af_id: 'af-0-new',
      stable_key: 'player:0:new',
      external_ids: { sportradar: 'sr-player-0' },
    })

    await recordCanonicalImportAuditForExistingLeague({
      userId: 'user-1',
      leagueId: 'league-1',
      provider: 'sleeper',
      normalized: {
        source: { source_league_id: 'source-1' },
        league: { season: 2026 },
        identity_mappings: mappings,
      } as never,
      canonical: {
        warnings: [
          { code: 'one', message: 'First warning', severity: 'warn' },
          { code: 'two', message: 'Second warning', severity: 'info' },
        ],
        reviewRequired: false,
        reviewReasons: [],
      } as never,
    })

    expect(h.transaction).toHaveBeenCalledTimes(1)
    expect(h.warningDeleteMany).toHaveBeenCalledWith({ where: { runId: 'run-1' } })
    expect(h.warningCreateMany).toHaveBeenCalledTimes(1)
    expect(h.warningCreateMany.mock.calls[0]?.[0].data).toHaveLength(2)
    expect(h.executeRaw).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(h.executeRaw.mock.calls)).toContain('sr-player-0')
    expect(JSON.stringify(h.executeRaw.mock.calls)).toContain('af-0-new')
    expect(h.reviewDeleteMany).toHaveBeenCalledTimes(1)
    expect(h.finishAttempt).toHaveBeenCalledWith('attempt-1', { status: 'completed' })
  })

  const retryInput = {
    userId: 'owner', provider: 'fantrax' as const,
    normalized: {
      source: { source_league_id: 'deleted-league' },
      league: { season: 2026 }, identity_mappings: [],
    } as never,
    canonical: { warnings: [], reviewRequired: false, reviewReasons: [] } as never,
    confirmReimportOfDeleted: true,
  }

  it('reuses the audit row after its league was deleted', async () => {
    const startedAt = new Date('2026-10-01T00:00:00Z')
    h.importRunFindUnique.mockResolvedValue({
      id: 'run-1', status: 'completed', leagueId: null, startedAt,
    })

    const result = await persistImportWithCanonicalAudit(retryInput)

    expect(result.skipped).toBe(false)
    expect(h.importRunCreate).not.toHaveBeenCalled()
    expect(h.importRunUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'run-1', status: 'completed', startedAt },
      data: expect.objectContaining({ status: 'running', completedAt: null }),
    }))
    expect(h.persistImported).toHaveBeenCalledWith(expect.objectContaining({
      confirmReimportOfDeleted: true,
    }))
  })

  it('reclaims a run stranded by an interrupted request', async () => {
    h.importRunFindUnique.mockResolvedValue({
      id: 'run-1', status: 'running', leagueId: null,
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    })

    await persistImportWithCanonicalAudit(retryInput)

    expect(h.importRunUpdateMany).toHaveBeenCalledTimes(1)
    expect(h.importRunCreate).not.toHaveBeenCalled()
  })

  it('retries a failed audit row with the same idempotency key', async () => {
    h.importRunFindUnique.mockResolvedValue({
      id: 'run-1', status: 'failed', leagueId: null, startedAt: new Date(),
    })

    await persistImportWithCanonicalAudit(retryInput)

    expect(h.importRunUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'failed' }),
      data: expect.objectContaining({ status: 'running', error: null }),
    }))
    expect(h.importRunCreate).not.toHaveBeenCalled()
  })

  it('reuses a failed audit row when importing into an existing league', async () => {
    h.importRunFindUnique.mockResolvedValue({
      id: 'run-1', status: 'failed', leagueId: 'league-1', startedAt: new Date(),
    })

    await recordCanonicalImportAuditForExistingLeague({
      userId: 'owner', leagueId: 'league-1', provider: 'fantrax',
      normalized: {
        source: { source_league_id: 'existing-league' },
        league: { season: 2026 }, identity_mappings: [],
      } as never,
      canonical: { warnings: [], reviewRequired: false, reviewReasons: [] } as never,
    })

    expect(h.importRunUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'failed' }),
      data: expect.objectContaining({ status: 'running' }),
    }))
    expect(h.importRunCreate).not.toHaveBeenCalled()
  })

  it('keeps an active import locked even for force retries', async () => {
    h.importRunFindUnique.mockResolvedValue({
      id: 'run-1', status: 'running', leagueId: null, startedAt: new Date(),
    })

    await expect(persistImportWithCanonicalAudit({ ...retryInput, allowUpdateExisting: true }))
      .rejects.toBeInstanceOf(ImportRunInFlightError)
    expect(h.importRunUpdateMany).not.toHaveBeenCalled()
    expect(h.persistImported).not.toHaveBeenCalled()
  })

  it('lets only one request claim an orphaned audit row', async () => {
    h.importRunFindUnique.mockResolvedValue({
      id: 'run-1', status: 'completed', leagueId: null, startedAt: new Date(),
    })
    h.importRunUpdateMany.mockResolvedValue({ count: 0 })

    await expect(persistImportWithCanonicalAudit(retryInput))
      .rejects.toBeInstanceOf(ImportRunInFlightError)
    expect(h.persistImported).not.toHaveBeenCalled()
  })
})
