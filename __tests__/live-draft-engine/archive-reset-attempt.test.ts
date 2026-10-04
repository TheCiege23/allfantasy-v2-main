// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/draft-room', () => ({ getManagerColorBySeed: () => '#ffffff' }))
const db = vi.hoisted(() => ({ session: vi.fn(), update: vi.fn(), event: vi.fn(), picks: vi.fn(), remove: vi.fn(), start: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { draftSession: { findFirst: db.session }, leagueSettings: { findUnique: vi.fn(async () => null) }, $transaction: async (fn: (tx: unknown) => unknown) => fn({ draftSession: { update: db.update }, draftPick: { findMany: db.picks, deleteMany: db.remove } }) } }))
vi.mock('@/lib/draft-archive/events', () => ({ recordArchiveEvent: db.event, updateSessionWithArchive: db.start }))
vi.mock('@/lib/league/league-roster-draft-gate', () => ({ isLeagueRosterDraftReady: vi.fn(async () => true) }))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({ getDraftConfigForLeague: vi.fn(async () => ({ timer_seconds: 90 })) }))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({ getDraftUISettingsForLeague: vi.fn(async () => ({ timerMode: 'none' })) }))
vi.mock('@/lib/events', () => ({ EVENT: { DRAFT_STARTED: 'draft.started' }, getPlatformEvents: () => ({ emit: vi.fn(async () => {}) }) }))
vi.mock('@/server/services/leagueLifecycleService', () => ({ applyDraftingLifecycleOnDraftResetInTransaction: vi.fn(async () => ({ applied: false })), applyPostDraftLifecycleInTransaction: vi.fn(), ensureDraftingLifecycleForActiveSession: vi.fn() }))
import { startDraftSession, resetDraftSession } from '@/lib/live-draft-engine/DraftSessionService'
describe('native reset attempt archive', () => {
  it('starting a legacy reset draft replaces stale start and completion timestamps', async () => {
    db.start.mockClear()
    db.session.mockResolvedValue({ id: 'd', leagueId: 'l', status: 'pre_draft', draftType: 'snake', teamCount: 2, rounds: 2, startedAt: new Date('2025-08-01'), completedAt: new Date('2025-08-02'), slotOrder: [{ slot: 1, rosterId: 'a', displayName: 'A' }, { slot: 2, rosterId: 'b', displayName: 'B' }] })
    const before = Date.now()
    expect(await startDraftSession('l')).toEqual({ ok: true })
    expect(db.start.mock.calls[0][1].startedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(db.start.mock.calls[0][1].completedAt).toBeNull()
  })
  it('archives the prior picks before clearing and starts a fresh timestamp/clock attempt', async () => {
    const prior = { id: 'd', leagueId: 'l', status: 'completed', startedAt: new Date('2026-08-01'), completedAt: new Date('2026-08-02') }
    db.session.mockResolvedValue(prior)
    db.picks.mockResolvedValue([{ overall: 1, playerName: 'Recorded player' }])
    expect(await resetDraftSession('l', { allowCompleted: true })).toBe(true)
    expect(db.event).toHaveBeenCalledWith(expect.anything(), prior, 'reset_draft', { priorSession: prior, archivedPicks: [{ overall: 1, playerName: 'Recorded player' }] })
    expect(db.event.mock.invocationCallOrder[0]).toBeLessThan(db.remove.mock.invocationCallOrder[0])
    expect(db.update.mock.calls[0][0].data).toMatchObject({ status: 'pre_draft', startedAt: null, completedAt: null, overnightFrozenPickSeconds: null, timerEndAt: null })
  })
})
