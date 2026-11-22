import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

const hm = vi.hoisted(() => ({
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

describe('POST /api/leagues/[leagueId]/draft/pick commissioner ordering', () => {
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

  it('rejects commissioner source spoofing by non-commissioner before gate elevation', async () => {
    hm.isCommissioner.mockResolvedValue(false)

    const { POST } = await import('@/app/api/leagues/[leagueId]/draft/pick/route')
    const req = createMockNextRequest('http://localhost/api/leagues/league-1/draft/pick', {
      method: 'POST',
      body: {
        playerName: 'Player One',
        position: 'RB',
        source: 'commissioner',
      },
    })

    const res = await POST(req as any, { params: Promise.resolve({ leagueId: 'league-1' }) })
    expect(res.status).toBe(403)
    expect(hm.assertLeagueActionGate).not.toHaveBeenCalled()
    expect(hm.submitPick).not.toHaveBeenCalled()
  })

  it('keeps commissioner override semantics for true commissioners', async () => {
    hm.isCommissioner.mockResolvedValue(true)

    const { POST } = await import('@/app/api/leagues/[leagueId]/draft/pick/route')
    const req = createMockNextRequest('http://localhost/api/leagues/league-1/draft/pick', {
      method: 'POST',
      body: {
        playerName: 'Player One',
        position: 'RB',
        rosterId: 'roster-9',
        source: 'commissioner',
      },
    })

    const res = await POST(req as any, { params: Promise.resolve({ leagueId: 'league-1' }) })
    expect(res.status).toBe(200)

    expect(hm.assertLeagueActionGate).toHaveBeenCalledWith(
      'league-1',
      'user-1',
      'draft_pick',
      expect.objectContaining({
        treatAsElevated: true,
        lifecycle: { commissionerOverride: true },
      }),
    )

    // 🛑 A commissioner-entered pick is made for the team ON THE CLOCK (roster-1), whatever roster the request names
    // (2026-11-15). The draft room sent the commissioner's own roster, so an offline commissioner who owned a team
    // drafted every player onto it.
    expect(hm.submitPick).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'commissioner',
        rosterId: 'roster-1',
      }),
      expect.any(Function),
    )
    // …and the league log records who made it, for which team.
    expect(hm.recordCommissionerDraftAction).toHaveBeenCalledWith('league-1', 'user-1', 'commissioner_pick', expect.objectContaining({ rosterId: 'roster-1' }))
  })

  // 🛑 Sleeper rewrites a mirrored draft on every sync, so a pick entered here would be silently undone (2026-11-15).
  it('refuses a commissioner pick on a draft mirrored from Sleeper', async () => {
    hm.isCommissioner.mockResolvedValue(true)
    hm.refuseIfSleeperMirrored.mockResolvedValueOnce({ body: { error: 'This draft runs on Sleeper.', code: 'SLEEPER_MIRRORED_DRAFT' }, status: 409 })

    const { POST } = await import('@/app/api/leagues/[leagueId]/draft/pick/route')
    const req = createMockNextRequest('http://localhost/api/leagues/league-1/draft/pick', {
      method: 'POST',
      body: { playerName: 'Player One', position: 'RB', source: 'commissioner' },
    })
    const res = await POST(req as any, { params: Promise.resolve({ leagueId: 'league-1' }) })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('SLEEPER_MIRRORED_DRAFT')
    expect(hm.submitPick).not.toHaveBeenCalled()
    expect(hm.recordCommissionerDraftAction).not.toHaveBeenCalled()
  })
})
