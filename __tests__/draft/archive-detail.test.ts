import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ gate: vi.fn(), commissioner: vi.fn(), catalog: vi.fn(), session: vi.fn(), audit: vi.fn(), events: vi.fn(), corrections: vi.fn(), picks: vi.fn(), trades: vi.fn(), executions: vi.fn() }))
vi.mock('@/server/services/permissionService', () => ({ canViewLeague: db.gate, isElevatedCommissioner: db.commissioner }))
vi.mock('@/lib/core-app/draftHq', () => ({ resolvePlayerNames: vi.fn(async () => new Map()) }))
vi.mock('@/lib/draft-archive/catalog', () => ({ draftArchiveCatalog: db.catalog }))
vi.mock('@/lib/draft-archive/ledger', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/draft-archive/ledger')>();
  return { ...actual, archiveLedger: async (_db: unknown, _league: string, _session: string, options: { take?: number }) => {
    if (options.take === 101) return db.events(options);
    const row = await db.audit(options);
    return row ? [row] : [];
  } };
})
vi.mock('@/lib/prisma', () => ({ prisma: {
  draftSession: { findFirst: db.session }, leagueAuditLog: { findFirst: db.audit, findMany: db.events },
  draftPickAuditLog: { findMany: db.corrections }, draftPick: { findMany: db.picks }, draftPickTradeProposal: { findMany: db.trades },
  tradeExecutionSnapshot: { findMany: db.executions },
} }))
import { draftArchiveDetail } from '@/lib/draft-archive/detail'
beforeEach(() => {
  vi.resetAllMocks()
  db.gate.mockResolvedValue(true)
  db.commissioner.mockResolvedValue(false)
  db.catalog.mockResolvedValue({ choices: [{ key: 'native:d', source: 'native', sourceId: 'd', format: 'snake', sport: 'NFL', season: 2026 }] })
  db.session.mockResolvedValue({ id: 'd', leagueId: 'l', status: 'pre_draft', startedAt: null })
  db.audit.mockResolvedValue(null)
  db.events.mockResolvedValue([])
  db.picks.mockResolvedValue([])
  db.trades.mockResolvedValue([])
  db.executions.mockResolvedValue([])
})
describe('draft archive authorization and attempt boundaries', () => {
  it('shows executed player packages in the draft window without exposing private metadata', async () => {
    const startedAt = new Date('2026-09-01'), completedAt = new Date('2026-09-02')
    db.session.mockResolvedValue({ id: 'd', leagueId: 'l', status: 'completed', startedAt, completedAt })
    db.executions.mockResolvedValue([{ tradeId: 'trade', executedAt: startedAt, completeness: 'complete', reversal: null, assetSummary: { items: 1, assets: [{ itemType: 'player', itemReference: 'player-id', fromRosterId: 'a', toRosterId: 'b', metadata: { playerName: 'Recorded player', privateNote: 'secret' } }] } }])
    const result = await draftArchiveDetail('l', 'viewer', 'native:d')
    expect(db.executions.mock.calls[0][0].where).toEqual({ leagueId: 'l', executedAt: { gte: startedAt, lte: completedAt } })
    expect(result?.playerTrades).toMatchObject([{ assets: [{ assetType: 'player', playerId: 'player-id', playerName: 'Recorded player' }] }])
    expect(JSON.stringify(result)).not.toContain('secret')
  })
  it('denies access before reading private archive data', async () => {
    db.gate.mockResolvedValue(false)
    expect(await draftArchiveDetail('l', 'stranger', 'native:d')).toBeNull()
    expect(db.catalog).not.toHaveBeenCalled()
    expect(db.session).not.toHaveBeenCalled()
  })
  it('a reset unstarted draft cannot inherit its previous attempt snapshot or clock', async () => {
    db.session.mockResolvedValue({ id: 'd', leagueId: 'l', status: 'pre_draft', startedAt: new Date('2025-09-01'), completedAt: new Date('2025-09-02') })
    const result = await draftArchiveDetail('l', 'viewer', 'native:d')
    expect(result?.startedAt).toBeNull()
    expect(result?.activeMs).toBeNull()
    expect(result?.endedAt).toBeNull()
    expect(db.audit).not.toHaveBeenCalled()
    expect(db.events).not.toHaveBeenCalled()
    expect(db.corrections).not.toHaveBeenCalled()
    expect(db.trades.mock.calls[0][0].where.respondedAt).toBeUndefined()
  })
  it('bounds timeline reads to the selected attempt and hides private correction notes', async () => {
    const startedAt = new Date('2026-09-01T00:00:00Z')
    db.session.mockResolvedValue({ id: 'd', leagueId: 'l', status: 'in_progress', startedAt })
    db.audit.mockResolvedValue({ createdAt: startedAt, afterState: { event: 'start', details: { secret: 'private-note' }, clock: { complete: true, totalActiveMs: 100 } } })
    db.events.mockResolvedValue([{ createdAt: startedAt, afterState: { event: 'pause', details: { reason: 'private-note' } } }])
    const result = await draftArchiveDetail('l', 'viewer', 'native:d')
    expect(db.audit.mock.calls[0][0].startAt).toEqual(startedAt.toISOString())
    expect(db.events.mock.calls[0][0].fromTime).toEqual(startedAt)
    expect(JSON.stringify(result)).not.toContain('private-note')
    expect(db.corrections).not.toHaveBeenCalled()
  })
  it('uses recorded team and actor names without loading current roster identities', async () => {
    const startedAt = new Date('2026-09-01T00:00:00Z')
    db.session.mockResolvedValue({ id: 'd', leagueId: 'l', status: 'completed', startedAt })
    db.audit.mockResolvedValue({ createdAt: startedAt, afterState: { snapshot: { session: { slotOrder: [{ rosterId: 'original', displayName: 'Original recorded team' }] }, teams: [{ claimedByUserId: 'actor', ownerName: 'Recorded manager' }] } } })
    db.picks.mockResolvedValue([{ id: 'p', overall: 1, round: 1, slot: 1, originalRosterId: 'original', rosterId: 'receiver', displayName: 'Receiving recorded team', ownerUserId: 'actor', playerName: 'Player', position: 'QB' }])
    const result = await draftArchiveDetail('l', 'viewer', 'native:d')
    expect(result?.picks[0]).toMatchObject({ originalTeamName: 'Original recorded team', actorName: 'Recorded manager', teamName: 'Receiving recorded team' })
  })
  it('bounds a reset attempt by mutation sequence when its observed timestamp moved backward', async () => {
    const startedAt = new Date('2026-09-01T00:00:10Z');
    db.catalog.mockResolvedValue({ choices: [{ key: 'reset:r', source: 'reset', sourceId: 'r', format: 'snake', sport: 'NFL', season: 2026 }] });
    const start = { createdAt: startedAt, afterState: { sequence: 10, event: 'start' } };
    db.audit.mockImplementation(async options => options.where?.id === 'r'
      ? { createdAt: new Date('2026-09-01T00:00:09Z'), afterState: { sequence: 20, details: { priorSession: { id: 'd', status: 'in_progress', startedAt: startedAt.toISOString() }, archivedPicks: [] } } }
      : start);
    await draftArchiveDetail('l', 'viewer', 'reset:r');
    expect(db.audit.mock.calls[1][0]).toMatchObject({ event: 'start', startAt: startedAt.toISOString(), beforeSequence: 20 });
    expect(db.events.mock.calls[0][0]).toMatchObject({ fromSequence: 10, beforeSequence: 20 });
  })
})
