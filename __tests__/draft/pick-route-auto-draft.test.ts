import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

/**
 * AUTO DRAFT: nobody picks by hand. The computer fills the board in bursts from the minute draft
 * tick; between bursts the room's Draft button still worked for whoever was on the clock, because
 * the pick path only knew the `offline` mode (production, 2026-11-25). The route now refuses any
 * pick but the commissioner's override in an auto draft.
 *
 * Same harness as pick-route-commissioner-ordering.test.ts.
 */

const hm = vi.hoisted(() => ({
  getDraftUISettingsForLeague: vi.fn(),
  getServerSession: vi.fn(),
  canAccessLeagueDraft: vi.fn(),
  canSubmitPickForRoster: vi.fn(),
  getCurrentUserRosterIdForLeague: vi.fn(),
  isCommissioner: vi.fn(),
  submitPick: vi.fn(),
  buildSessionSnapshot: vi.fn(),
  appendPickToRosterDraftSnapshot: vi.fn(),
  ensureDraftingLifecycleForActiveSession: vi.fn(),
  assertLeagueActionGate: vi.fn(),
  logAction: vi.fn(),
  publishDraftIntelForUpcomingManagers: vi.fn(),
  sendDraftIntelDm: vi.fn(),
  refuseIfSleeperMirrored: vi.fn(),
  recordCommissionerDraftAction: vi.fn(),
}))

vi.mock('@/lib/draft-room/commissionerDraftActions', () => ({
  refuseIfSleeperMirrored: hm.refuseIfSleeperMirrored,
  recordCommissionerDraftAction: hm.recordCommissionerDraftAction,
}))

vi.mock('next-auth', () => ({
  getServerSession: hm.getServerSession,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: hm.canAccessLeagueDraft,
  canSubmitPickForRoster: hm.canSubmitPickForRoster,
  getCurrentUserRosterIdForLeague: hm.getCurrentUserRosterIdForLeague,
}))

vi.mock('@/lib/commissioner/permissions', () => ({
  isCommissioner: hm.isCommissioner,
}))

vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({
  submitPick: hm.submitPick,
}))

vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  buildSessionSnapshot: hm.buildSessionSnapshot,
}))

vi.mock('@/lib/live-draft-engine/RosterAssignmentService', () => ({
  appendPickToRosterDraftSnapshot: hm.appendPickToRosterDraftSnapshot,
}))

vi.mock('@/server/services/leagueLifecycleService', () => ({
  ensureDraftingLifecycleForActiveSession: hm.ensureDraftingLifecycleForActiveSession,
}))

vi.mock('@/server/services/leagueActionGate', () => ({
  assertLeagueActionGate: hm.assertLeagueActionGate,
}))

vi.mock('@/server/services/auditService', () => ({
  logAction: hm.logAction,
}))

vi.mock('@/lib/draft-notifications', () => ({
  notifyDraftIntelOnClockUrgent: vi.fn().mockResolvedValue(undefined),
  notifyDraftIntelPickConfirmation: vi.fn().mockResolvedValue(undefined),
  notifyDraftIntelPlayerTaken: vi.fn().mockResolvedValue(undefined),
  notifyDraftIntelQueueReady: vi.fn().mockResolvedValue(undefined),
  notifyDraftIntelTierBreak: vi.fn().mockResolvedValue(undefined),
  notifyOnTheClockAfterPick: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/draft-intelligence', () => ({
  publishDraftIntelForUpcomingManagers: hm.publishDraftIntelForUpcomingManagers,
  sendDraftIntelDm: hm.sendDraftIntelDm,
}))
// Routes ask lib/league/commissionerAccess.ts (2026-11-16); this defers to the old check this test mocks.
vi.mock('@/lib/league/commissionerAccess', async () => (await import('../helpers/commissionerAccessMock')).accessFromLegacyMocks())

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: hm.getDraftUISettingsForLeague,
}))

describe('POST /api/leagues/[leagueId]/draft/pick in an auto draft', () => {
  // An accepted pick starts fire-and-forget work (notifications, audit) that logs after the response.
  // A log still in flight when the worker closes fails the RUN, not a test — about one run in twelve
  // on the sibling suite this harness comes from. Let that work finish before the file ends.
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250))
  })

  beforeEach(() => {
    vi.clearAllMocks()
    hm.getServerSession.mockResolvedValue({ user: { id: 'user-1' } })
    hm.canAccessLeagueDraft.mockResolvedValue(true)
    hm.canSubmitPickForRoster.mockResolvedValue(true)
    hm.getCurrentUserRosterIdForLeague.mockResolvedValue('roster-1')
    hm.ensureDraftingLifecycleForActiveSession.mockResolvedValue(undefined)
    hm.assertLeagueActionGate.mockResolvedValue({ ok: true })
    hm.logAction.mockResolvedValue(undefined)
    hm.submitPick.mockResolvedValue({
      success: true,
      snapshot: {
        sessionId: 'session-1',
        overall: 1,
        round: 1,
        slot: 1,
        rosterId: 'roster-1',
        playerName: 'Player One',
        position: 'RB',
        team: 'DAL',
        byeWeek: null,
      },
    })
    hm.buildSessionSnapshot
      .mockResolvedValueOnce({
        currentPick: {
          overall: 1,
          rosterId: 'roster-1',
          pickLabel: '1.01',
        },
      })
      .mockResolvedValue({
        currentPick: {
          overall: 2,
          rosterId: 'roster-2',
          pickLabel: '1.02',
        },
        picks: [{ playerName: 'Player One', position: 'RB' }],
      })
    hm.publishDraftIntelForUpcomingManagers.mockResolvedValue([])
    hm.sendDraftIntelDm.mockResolvedValue(null)
  })

  const post = async (body: Record<string, unknown>) => {
    const { POST } = await import('@/app/api/leagues/[leagueId]/draft/pick/route')
    const req = createMockNextRequest('http://localhost/api/leagues/league-1/draft/pick', { method: 'POST', body })
    return POST(req as any, { params: Promise.resolve({ leagueId: 'league-1' }) })
  }
  const pick = { playerName: 'Player One', position: 'RB', rosterId: 'roster-1' }

  it('refuses the on-the-clock manager’s own pick, before anything is written', async () => {
    hm.isCommissioner.mockResolvedValue(false)
    hm.getDraftUISettingsForLeague.mockResolvedValue({ executionMode: 'auto' })

    const res = await post(pick)

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'DRAFT_PICK_AUTO_DRAFT', error: 'This is an auto draft: every pick is made automatically.' })
    expect(hm.submitPick).not.toHaveBeenCalled()
    expect(hm.assertLeagueActionGate).not.toHaveBeenCalled()
  })

  it('refuses every hand-pick source a room can send, including one labelled auto', async () => {
    hm.isCommissioner.mockResolvedValue(false)
    hm.getDraftUISettingsForLeague.mockResolvedValue({ executionMode: 'auto' })

    for (const source of ['user', 'auto', 'devy', 'college', 'promoted_devy', 'keeper']) {
      const res = await post({ ...pick, source })
      expect(res.status, source).toBe(409)
    }
    expect(hm.submitPick).not.toHaveBeenCalled()
  })

  it('a commissioner who clicks Draft for their own team is refused like anyone else', async () => {
    hm.isCommissioner.mockResolvedValue(true)
    hm.getDraftUISettingsForLeague.mockResolvedValue({ executionMode: 'auto' })

    const res = await post(pick)

    expect(res.status).toBe(409)
    expect(hm.submitPick).not.toHaveBeenCalled()
  })

  it('still lets the commissioner’s override correct the board', async () => {
    hm.isCommissioner.mockResolvedValue(true)
    hm.refuseIfSleeperMirrored.mockResolvedValue(null)
    hm.getDraftUISettingsForLeague.mockResolvedValue({ executionMode: 'auto' })

    const res = await post({ ...pick, source: 'commissioner' })

    expect(res.status).toBe(200)
    expect(hm.submitPick).toHaveBeenCalledTimes(1)
    expect(hm.submitPick.mock.calls[0]![0]).toMatchObject({ source: 'commissioner', commissionerOverride: true })
  })

  it('control: the same pick goes through in a live draft', async () => {
    hm.isCommissioner.mockResolvedValue(false)
    hm.getDraftUISettingsForLeague.mockResolvedValue({ executionMode: 'live' })

    const res = await post(pick)

    expect(res.status).toBe(200)
    expect(hm.submitPick).toHaveBeenCalledTimes(1)
  })

  it('a settings read that fails never costs a manager their pick', async () => {
    hm.isCommissioner.mockResolvedValue(false)
    hm.getDraftUISettingsForLeague.mockRejectedValue(new Error('db down'))

    const res = await post(pick)

    expect(res.status).toBe(200)
    expect(hm.submitPick).toHaveBeenCalledTimes(1)
  })
})
