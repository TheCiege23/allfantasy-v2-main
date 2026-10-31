import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  importRunFindUnique: vi.fn(),
  importRunCreate: vi.fn(),
  importRunUpdate: vi.fn(),
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
      create: h.importRunCreate,
      update: h.importRunUpdate,
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

import { persistImportWithCanonicalAudit, recordCanonicalImportAuditForExistingLeague } from '@/lib/league-import/importPersistenceService'

describe('import persistence batching', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.importRunFindUnique.mockResolvedValue(null)
    h.importRunCreate.mockResolvedValue({ id: 'run-1', rawPayloadHash: 'hash-1' })
    h.importRunUpdate.mockResolvedValue({})
    h.leagueFindUnique.mockResolvedValue({ id: 'league-1', name: 'Scale league', sport: 'NBA' })
    h.persistImported.mockResolvedValue({
      league: { id: 'league-1', name: 'Scale league', sport: 'NBA' },
      incompleteSteps: [], joinedExisting: true,
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

  it('uses a different audit key for each team owned by one Fantrax account', async () => {
    const normalized = (teamId: string) => ({
      source: { source_league_id: 'fantrax-league' },
      league: { season: 2026 },
      viewer_source_team_id: teamId,
      identity_mappings: [],
    }) as never
    const canonical = { warnings: [], reviewRequired: false, reviewReasons: [] } as never
    let completedKey = ''
    h.importRunFindUnique.mockImplementation(async ({ where }: { where: { idempotencyKey: string } }) =>
      where.idempotencyKey === completedKey
        ? { id: 'run-1', leagueId: 'league-1', status: 'completed' }
        : null)

    await persistImportWithCanonicalAudit({
      userId: 'owner', provider: 'fantrax', normalized: normalized('team-1'), canonical,
    })
    completedKey = h.importRunCreate.mock.calls[0]?.[0].data.idempotencyKey
    expect(completedKey).toContain(':team:')

    const retry = await persistImportWithCanonicalAudit({
      userId: 'owner', provider: 'fantrax', normalized: normalized('team-1'), canonical,
    })
    expect(retry.skipped).toBe(true)

    const otherTeam = await persistImportWithCanonicalAudit({
      userId: 'owner', provider: 'fantrax', normalized: normalized('team-2'), canonical,
    })
    expect(otherTeam.skipped).toBe(false)
    expect(h.persistImported).toHaveBeenCalledTimes(2)
    expect(h.importRunCreate).toHaveBeenCalledTimes(2)
    expect(h.importRunCreate.mock.calls[1]?.[0].data.idempotencyKey).not.toBe(completedKey)
  })
})
