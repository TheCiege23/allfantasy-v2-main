import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ gate: vi.fn(), commissioner: vi.fn(), catalog: vi.fn(), session: vi.fn(), audit: vi.fn(), events: vi.fn(), corrections: vi.fn(), picks: vi.fn(), trades: vi.fn() }))
vi.mock('@/server/services/permissionService', () => ({ canViewLeague: db.gate, isElevatedCommissioner: db.commissioner }))
vi.mock('@/lib/core-app/draftHq', () => ({ resolvePlayerNames: vi.fn(async () => new Map()) }))
vi.mock('@/lib/draft-archive/catalog', () => ({ draftArchiveCatalog: db.catalog }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  draftSession: { findFirst: db.session }, leagueAuditLog: { findFirst: db.audit, findMany: db.events },
  draftPickAuditLog: { findMany: db.corrections }, draftPick: { findMany: db.picks }, draftPickTradeProposal: { findMany: db.trades },
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
})
describe('draft archive authorization and attempt boundaries', () => {
  it('denies access before reading private archive data', async () => {
    db.gate.mockResolvedValue(false)
    expect(await draftArchiveDetail('l', 'stranger', 'native:d')).toBeNull()
    expect(db.catalog).not.toHaveBeenCalled()
    expect(db.session).not.toHaveBeenCalled()
  })
  it('a reset unstarted draft cannot inherit its previous attempt snapshot or clock', async () => {
    const result = await draftArchiveDetail('l', 'viewer', 'native:d')
    expect(result?.startedAt).toBeNull()
    expect(result?.activeMs).toBeNull()
    expect(db.audit).not.toHaveBeenCalled()
    expect(db.events).not.toHaveBeenCalled()
    expect(db.corrections).not.toHaveBeenCalled()
  })
  it('bounds timeline reads to the selected attempt and hides private correction notes', async () => {
    const startedAt = new Date('2026-09-01T00:00:00Z')
    db.session.mockResolvedValue({ id: 'd', leagueId: 'l', status: 'in_progress', startedAt })
    db.audit.mockResolvedValue({ createdAt: startedAt, afterState: { event: 'start', details: { secret: 'private-note' }, clock: { complete: true, totalActiveMs: 100 } } })
    db.events.mockResolvedValue([{ createdAt: startedAt, afterState: { event: 'pause', details: { reason: 'private-note' } } }])
    const result = await draftArchiveDetail('l', 'viewer', 'native:d')
    expect(db.audit.mock.calls[0][0].where.createdAt.gte).toEqual(startedAt)
    expect(db.events.mock.calls[0][0].where.createdAt.gte).toEqual(startedAt)
    expect(JSON.stringify(result)).not.toContain('private-note')
    expect(db.corrections).not.toHaveBeenCalled()
  })
})
