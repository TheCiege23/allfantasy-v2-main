import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ latest: vi.fn(), create: vi.fn(), picks: vi.fn(), update: vi.fn(), league: vi.fn(), teams: vi.fn(), rosters: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: db.transaction } }))
import { recordArchiveEvent, updateSessionWithArchive } from '@/lib/draft-archive/events'
const session = { id: 'draft', leagueId: 'league', status: 'in_progress', draftType: 'snake', teamCount: 2, rounds: 2, slotOrder: [{ slot: 1, rosterId: 'a' }, { slot: 2, rosterId: 'b' }], timerSeconds: 90 }
const tx = { $queryRaw: vi.fn().mockResolvedValue([]), aFProjectionSnapshot: { findMany: vi.fn().mockResolvedValue([]) }, leagueAuditLog: { findFirst: db.latest, create: db.create }, draftPick: { findMany: db.picks }, draftSession: { update: db.update }, league: { findUnique: db.league }, leagueTeam: { findMany: db.teams }, roster: { findMany: db.rosters } }
beforeEach(() => {
  vi.resetAllMocks()
  tx.aFProjectionSnapshot.findMany.mockResolvedValue([])
  db.latest.mockResolvedValue(null)
  db.create.mockResolvedValue({ id: 'event' })
  db.picks.mockResolvedValue([])
  db.update.mockResolvedValue(session)
  db.transaction.mockImplementation(async fn => fn(tx))
  db.league.mockResolvedValue({ season: 2026, sport: 'NFL', scoring: 'ppr', settings: { roster_positions: ['QB'], scoring_settings: { rec: 1 } } })
  db.teams.mockResolvedValue([{ externalId: 'a', teamName: 'A' }])
  db.rosters.mockResolvedValue([{ id: 'roster', playerData: { players: ['existing'] } }])
})
describe('durable draft archive events', () => {
  it('uses the verified start timestamp as the projection cutoff and clock origin', async () => {
    const startedAt = new Date('2026-09-01T00:00:00Z')
    db.update.mockResolvedValue({ ...session, startedAt })
    await updateSessionWithArchive(session, { status: 'in_progress' }, 'start')
    expect(tx.aFProjectionSnapshot.findMany.mock.calls[0][0].where.computedAt.lte).toEqual(startedAt)
    expect(db.create.mock.calls[0][0].data.createdAt).toEqual(startedAt)
  })
  it('freezes original rules and existing roster data inside the start transaction', async () => {
    await updateSessionWithArchive(session, { status: 'in_progress' }, 'start')
    expect(db.transaction).toHaveBeenCalledOnce()
    expect(db.update.mock.invocationCallOrder[0]).toBeLessThan(db.create.mock.invocationCallOrder[0])
    const stored = db.create.mock.calls[0][0].data.afterState
    expect(stored.snapshot.rosters[0].playerData.players).toEqual(['existing'])
    expect(stored.context.season).toBe(2026)
    expect(stored.clock).toMatchObject({ overall: 1, owner: 'a', complete: true })
  })
  it('propagates audit failures from the transaction instead of committing an unarchived transition', async () => {
    db.create.mockRejectedValue(new Error('audit unavailable'))
    await expect(updateSessionWithArchive(session, { status: 'paused' }, 'pause')).rejects.toThrow('audit unavailable')
    expect(db.transaction).toHaveBeenCalledOnce()
  })
  it('does not reject a valid selection because wall clock moved backwards', async () => {
    db.latest.mockResolvedValue({ afterState: { context: { season: 2026 }, clock: { version: 1, at: '2026-08-01T00:00:10Z', overall: 1, owner: 'a', running: true, activeMs: 0, byOwner: {}, totalActiveMs: 0, complete: true } } })
    const result = await recordArchiveEvent(tx as never, session, 'selection', { overall: 1, nextOverall: 2 }, new Date('2026-08-01T00:00:09Z'))
    expect(result.selected).toBeNull()
    expect(result.clock.complete).toBe(false)
    expect(result.context).toEqual({ season: 2026 })
  })
  it('keeps a paused selection clock stopped and uses canonical open slots', async () => {
    db.picks.mockResolvedValue([{ overall: 1, playerName: 'Keeper', position: 'QB', pickMetadata: null }])
    const result = await recordArchiveEvent(tx as never, { ...session, status: 'paused' }, 'pause')
    expect(result.clock).toMatchObject({ overall: 2, owner: 'b', running: false, complete: false })
  })
})
