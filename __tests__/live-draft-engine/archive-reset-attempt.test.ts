import { describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ session: vi.fn(), update: vi.fn(), event: vi.fn(), picks: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { draftSession: { findFirst: db.session }, $transaction: async (fn: (tx: unknown) => unknown) => fn({ draftSession: { update: db.update }, draftPick: { findMany: db.picks, deleteMany: db.remove } }) } }))
vi.mock('@/lib/draft-archive/events', () => ({ recordArchiveEvent: db.event, updateSessionWithArchive: vi.fn() }))
vi.mock('@/server/services/leagueLifecycleService', () => ({ applyDraftingLifecycleOnDraftResetInTransaction: vi.fn(async () => ({ applied: false })), applyPostDraftLifecycleInTransaction: vi.fn(), ensureDraftingLifecycleForActiveSession: vi.fn() }))
describe('native reset attempt archive', () => {
  it('archives the prior picks before clearing and starts a fresh timestamp/clock attempt', async () => {
    const prior = { id: 'd', leagueId: 'l', status: 'completed', startedAt: new Date('2026-08-01'), completedAt: new Date('2026-08-02') }
    db.session.mockResolvedValue(prior)
    db.picks.mockResolvedValue([{ overall: 1, playerName: 'Recorded player' }])
    const { resetDraftSession } = await import('@/lib/live-draft-engine/DraftSessionService')
    expect(await resetDraftSession('l', { allowCompleted: true })).toBe(true)
    expect(db.event).toHaveBeenCalledWith(expect.anything(), prior, 'reset_draft', { priorSession: prior, archivedPicks: [{ overall: 1, playerName: 'Recorded player' }] })
    expect(db.event.mock.invocationCallOrder[0]).toBeLessThan(db.remove.mock.invocationCallOrder[0])
    expect(db.update.mock.calls[0][0].data).toMatchObject({ status: 'pre_draft', startedAt: null, completedAt: null, overnightFrozenPickSeconds: null, timerEndAt: null })
  })
})
