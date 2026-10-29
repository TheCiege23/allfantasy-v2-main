// @vitest-environment node
/**
 * `startDraftSession` claims the pre_draft session with a conditional update before it starts it.
 *
 * The control lock alone is not enough: it fails OPEN on a lock-store outage and its 8 s TTL is
 * shorter than a start can take, so two callers (two overlapping draft ticks, a tick and the
 * commissioner's Start button, a double click) could both read pre_draft and both start.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/draft-room', () => ({ getManagerColorBySeed: () => '#ffffff' }))
const db = vi.hoisted(() => ({ session: vi.fn(), claim: vi.fn(), start: vi.fn(), emit: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findFirst: db.session, updateMany: db.claim },
    league: { findUnique: vi.fn(async () => null) },
    leagueSettings: { findUnique: vi.fn(async () => ({ aiAutoPick: false, cpuAutoPick: true, playerPool: 'all', alphabeticalSort: false })) },
  },
}))
vi.mock('@/lib/draft-archive/events', () => ({ recordArchiveEvent: vi.fn(), updateSessionWithArchive: db.start }))
vi.mock('@/lib/league/league-roster-draft-gate', () => ({ isLeagueRosterDraftReady: vi.fn(async () => true) }))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({ getDraftConfigForLeague: vi.fn(async () => ({ timer_seconds: 90 })) }))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({ getDraftUISettingsForLeague: vi.fn(async () => ({ timerMode: 'none' })) }))
vi.mock('@/lib/events', () => ({ EVENT: { DRAFT_STARTED: 'draft.started' }, getPlatformEvents: () => ({ emit: db.emit }) }))
vi.mock('@/server/services/leagueLifecycleService', () => ({ ensureDraftingLifecycleForActiveSession: vi.fn(), applyDraftingLifecycleOnDraftResetInTransaction: vi.fn(), applyPostDraftLifecycleInTransaction: vi.fn() }))
import { startDraftSession } from '@/lib/live-draft-engine/DraftSessionService'

const session = { id: 'd', leagueId: 'l', status: 'pre_draft', draftType: 'snake', teamCount: 2, rounds: 2, version: 7, slotOrder: [{ slot: 1, rosterId: 'a', displayName: 'A' }, { slot: 2, rosterId: 'b', displayName: 'B' }] }

describe('startDraftSession conditional claim', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.session.mockResolvedValue(session)
    db.claim.mockResolvedValue({ count: 1 })
    db.start.mockResolvedValue({})
  })

  it('claims only a pre_draft session at the version it read, then starts at the claimed version', async () => {
    expect(await startDraftSession('l')).toEqual({ ok: true })
    expect(db.claim).toHaveBeenCalledOnce()
    expect(db.claim.mock.calls[0][0].where).toEqual({ id: 'd', status: 'pre_draft', version: 7 })
    expect(db.claim.mock.calls[0][0].data).toMatchObject({ cpuAutoPick: true, version: { increment: 1 } })
    expect(db.start).toHaveBeenCalledOnce()
    expect(db.start.mock.calls[0][1]).toMatchObject({ status: 'in_progress' })
    expect(db.start.mock.calls[0][4]).toBe(8)
  })

  it('does nothing when another caller claimed the session first', async () => {
    db.claim.mockResolvedValue({ count: 0 })
    expect(await startDraftSession('l')).toEqual({ ok: false, reason: 'session_not_ready' })
    expect(db.start).not.toHaveBeenCalled()
    expect(db.emit).not.toHaveBeenCalled()
  })

  it('reports a start that lost the race after its claim as not ready rather than throwing', async () => {
    db.start.mockRejectedValue(Object.assign(new Error('Record to update not found.'), { code: 'P2025' }))
    expect(await startDraftSession('l')).toEqual({ ok: false, reason: 'session_not_ready' })
  })

  it('still throws an unrelated failure', async () => {
    db.start.mockRejectedValue(new Error('connection reset'))
    await expect(startDraftSession('l')).rejects.toThrow('connection reset')
  })
})
