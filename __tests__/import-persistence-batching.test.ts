import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  importRunFindUnique: vi.fn(),
  importRunCreate: vi.fn(),
  importRunUpdate: vi.fn(),
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
      create: h.importRunCreate,
      update: h.importRunUpdate,
    },
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
  persistImportedLeagueFromNormalization: vi.fn(),
}))

import { recordCanonicalImportAuditForExistingLeague } from '@/lib/league-import/importPersistenceService'

describe('import persistence batching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.importRunFindUnique.mockResolvedValue(null)
    h.importRunCreate.mockResolvedValue({ id: 'run-1', rawPayloadHash: 'hash-1' })
    h.importRunUpdate.mockResolvedValue({})
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
})
