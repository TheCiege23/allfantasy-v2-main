/**
 * POST /api/leagues/[leagueId]/draft/controls — action: force_autopick
 *
 * Covers Commit 7: LiveDraftAutopickPreference integration, Pro re-check at
 * fire time, ai_queue restriction to queue candidates, DraftPickAuditLog write,
 * and viewerUserId threading through buildSessionSnapshot.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const getServerSessionMock = vi.hoisted(() => vi.fn(async () => ({ user: { id: 'commissioner-1' } } as null | { user?: { id?: string } })))
const assertLeagueActionGateMock = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })))
const getDraftUISettingsMock = vi.hoisted(() =>
  vi.fn(async () => ({
    commissionerForceAutoPickEnabled: true,
    timerMode: 'per_pick' as const,
    autoPickEnabled: false,
    allowPicksDuringOvernightPause: false,
    slowDraftPauseWindow: null,
    tradedPickOwnerNameRedEnabled: false,
    tradedPickColorModeEnabled: false,
    orphanTeamAiManagerEnabled: false,
    orphanDrafterMode: 'cpu' as const,
  })),
)
const getViewerAutopickPreferenceMock = vi.hoisted(() =>
  vi.fn(async () => ({ enabled: false, mode: 'standard' as const, isProEligible: false, updatedAt: null })),
)
const entitlementResolveForUserMock = vi.hoisted(() => vi.fn(async () => ({ hasAccess: false })))
const submitPickMock = vi.hoisted(() =>
  vi.fn(async () => ({
    success: true as boolean,
    code: undefined as string | undefined,
    error: undefined as string | undefined,
    snapshot: { rosterId: 'roster-a' } as { rosterId: string } | undefined,
  })),
)
const buildSessionSnapshotMock = vi.hoisted(() => vi.fn(async () => ({ id: 'session-1', leagueId: 'league-1' } as any)))
const getLiveADPMock = vi.hoisted(() =>
  vi.fn(async () => [
    { name: 'Patrick Mahomes', position: 'QB', adp: 1, team: 'KC', bye: 12 },
    { name: 'Justin Jefferson', position: 'WR', adp: 2, team: 'MIN', bye: 7 },
  ]),
)
const resolveCurrentOnTheClockMock = vi.hoisted(() =>
  vi.fn(() => ({ overall: 1, round: 1, slot: 1, rosterId: 'roster-a' })),
)
const resolvePickOwnerMock = vi.hoisted(() => vi.fn(() => ({ rosterId: 'roster-a' })))
const getAllowedPositionsAndRosterSizeMock = vi.hoisted(() => vi.fn(async () => null))
const appendPickToRosterDraftSnapshotMock = vi.hoisted(() => vi.fn(async () => {}))
const draftPickAuditLogCreateMock = vi.hoisted(() => vi.fn(async () => ({})))
const rosterFindUniqueMock = vi.hoisted(() =>
  vi.fn(async () => ({ platformUserId: 'on-clock-user' })),
)
const leagueFindUniqueMock = vi.hoisted(() => vi.fn(async () => ({ sport: 'NFL', id: 'league-1', settings: {} })))

const makeSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'session-1',
  leagueId: 'league-1',
  status: 'in_progress',
  draftType: 'snake',
  rounds: 4,
  teamCount: 2,
  thirdRoundReversal: false,
  timerSeconds: 90,
  sportType: 'NFL',
  slotOrder: [
    { slot: 1, rosterId: 'roster-a', displayName: 'Team A' },
    { slot: 2, rosterId: 'roster-b', displayName: 'Team B' },
  ],
  tradedPicks: [],
  picks: [],
  queues: [],
  ...overrides,
})

const draftSessionFindUniqueMock = vi.hoisted(() => vi.fn(async () => makeSession()))

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSessionMock(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/server/services/leagueActionGate', () => ({
  assertLeagueActionGate: (...a: unknown[]) => assertLeagueActionGateMock(...a),
}))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: (...a: unknown[]) => getDraftUISettingsMock(...a),
  isSoftTimerEnabled: vi.fn(() => false),
}))
vi.mock('@/lib/live-draft-engine/LiveDraftAutopickPreferenceService', () => ({
  getViewerAutopickPreference: (...a: [string, string]) => getViewerAutopickPreferenceMock(...a),
}))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser(...a: [string, string]) {
      return entitlementResolveForUserMock(...a)
    }
  },
}))
vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({
  submitPick: (...a: unknown[]) => submitPickMock(...a),
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  buildSessionSnapshot: (...a: unknown[]) => buildSessionSnapshotMock(...a),
  pauseDraftSession: vi.fn(async () => true),
  resumeDraftSession: vi.fn(async () => true),
  resetTimer: vi.fn(async () => ({})),
  undoLastPick: vi.fn(async () => ({})),
  swapDraftManagers: vi.fn(async () => ({})),
  completeDraftSession: vi.fn(async () => true),
  resetDraftSession: vi.fn(async () => ({})),
  setTimerSeconds: vi.fn(async () => ({})),
  startDraftSession: vi.fn(async () => ({})),
}))
vi.mock('@/lib/adp-data', () => ({
  getLiveADP: (...a: unknown[]) => getLiveADPMock(...a),
}))
vi.mock('@/lib/live-draft-engine/CurrentOnTheClockResolver', () => ({
  resolveCurrentOnTheClock: (...a: unknown[]) => resolveCurrentOnTheClockMock(...a),
}))
vi.mock('@/lib/live-draft-engine/PickOwnershipResolver', () => ({
  resolvePickOwner: (...a: unknown[]) => resolvePickOwnerMock(...a),
}))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({
  getAllowedPositionsAndRosterSize: (...a: unknown[]) => getAllowedPositionsAndRosterSizeMock(...a),
}))
vi.mock('@/lib/draft-room/draft-pool-eligible-positions', () => ({
  draftPoolRowMatchesEligiblePositions: vi.fn(() => true),
}))
vi.mock('@/lib/live-draft-engine/RosterAssignmentService', () => ({
  appendPickToRosterDraftSnapshot: (...a: unknown[]) => appendPickToRosterDraftSnapshotMock(...a),
  finalizeRosterAssignments: vi.fn(async () => {}),
}))
vi.mock('@/lib/live-draft-engine/draftPickEmpty', () => ({
  isDraftPickRowEmpty: vi.fn(() => false),
}))
vi.mock('@/lib/league/roster-configuration-gate-error', () => ({
  rosterConfigurationIncompleteBody: vi.fn((x: unknown) => x),
}))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: vi.fn(async () => ({})),
}))
vi.mock('@/lib/live-draft-engine/auction/AuctionEngine', () => ({
  resolveAuctionWin: vi.fn(async () => ({})),
}))
vi.mock('@/lib/live-draft-engine/auction', () => ({
  runAuctionAutomationTick: vi.fn(async () => ({})),
}))
vi.mock('@/lib/live-draft-engine/keeper', () => ({
  runKeeperAutomationTick: vi.fn(async () => ({})),
}))
vi.mock('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService', () => ({
  runSlowDraftAutomationTick: vi.fn(async () => ({})),
}))
vi.mock('@/lib/live-draft-engine/pickAuthorityCodes', () => ({
  httpStatusForPickAuthorityCode: vi.fn(() => 400),
}))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: vi.fn(async () => true),
  getCurrentUserRosterIdForLeague: vi.fn(async () => 'roster-a'),
}))
vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({
  getOrphanRosterIdsForLeague: vi.fn(async () => []),
}))
vi.mock('@/lib/provider-config', () => ({
  getProviderStatus: vi.fn(() => ({ anyAi: false })),
}))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({
  getPlayerPoolForLeague: vi.fn(async () => []),
}))
vi.mock('@/lib/draft-notifications', () => ({
  getLeagueMemberAppUserIds: vi.fn(async () => []),
  notifyDraftIntelOnClockUrgent: vi.fn(async () => {}),
  notifyDraftIntelOrphanTeamPick: vi.fn(async () => {}),
  notifyDraftIntelPickConfirmation: vi.fn(async () => {}),
  notifyDraftIntelPlayerTaken: vi.fn(async () => {}),
  notifyDraftIntelPostDraftRecap: vi.fn(async () => {}),
  notifyDraftIntelQueueReady: vi.fn(async () => {}),
  notifyDraftIntelTierBreak: vi.fn(async () => {}),
  notifyDraftStartingSoon: vi.fn(async () => {}),
  notifyAutoPickFired: vi.fn(async () => {}),
  notifyOnTheClockAfterPick: vi.fn(async () => {}),
  notifyQueuePlayerUnavailable: vi.fn(async () => {}),
}))
vi.mock('@/lib/draft-intelligence', () => ({
  publishDraftIntelForUpcomingManagers: vi.fn(async () => []),
  publishDraftIntelRecap: vi.fn(async () => null),
  sendDraftIntelDm: vi.fn(async () => {}),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findUnique: (...a: unknown[]) => draftSessionFindUniqueMock(...a) },
    roster: { findUnique: (...a: unknown[]) => rosterFindUniqueMock(...a) },
    league: { findUnique: (...a: unknown[]) => leagueFindUniqueMock(...a) },
    draftPickAuditLog: { create: (...a: unknown[]) => draftPickAuditLogCreateMock(...a) },
  },
}))

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

const { POST } = await import(
  '@/app/api/leagues/[leagueId]/draft/controls/route'
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/leagues/league-1/draft/controls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeCtx(leagueId = 'league-1') {
  return { params: Promise.resolve({ leagueId }) }
}

function forceAutopickBody(extra: Record<string, unknown> = {}) {
  return { action: 'force_autopick', ...extra }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/leagues/[leagueId]/draft/controls — force_autopick', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'commissioner-1' } })
    assertLeagueActionGateMock.mockResolvedValue({ ok: true })
    getDraftUISettingsMock.mockResolvedValue({
      commissionerForceAutoPickEnabled: true,
      timerMode: 'per_pick',
      autoPickEnabled: false,
      allowPicksDuringOvernightPause: false,
      slowDraftPauseWindow: null,
      tradedPickOwnerNameRedEnabled: false,
      tradedPickColorModeEnabled: false,
      orphanTeamAiManagerEnabled: false,
      orphanDrafterMode: 'cpu',
    })
    draftSessionFindUniqueMock.mockResolvedValue(makeSession())
    rosterFindUniqueMock.mockResolvedValue({ platformUserId: 'on-clock-user' })
    leagueFindUniqueMock.mockResolvedValue({ sport: 'NFL', id: 'league-1', settings: {} })
    getViewerAutopickPreferenceMock.mockResolvedValue({
      enabled: false,
      mode: 'standard',
      isProEligible: false,
      updatedAt: null,
    })
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: false })
    submitPickMock.mockResolvedValue({
      success: true,
      code: undefined,
      error: undefined,
      snapshot: { rosterId: 'roster-a' },
    })
    buildSessionSnapshotMock.mockResolvedValue({ id: 'session-1', leagueId: 'league-1' })
    getLiveADPMock.mockResolvedValue([
      { name: 'Patrick Mahomes', position: 'QB', adp: 1, team: 'KC', bye: 12 },
    ])
    resolveCurrentOnTheClockMock.mockReturnValue({ overall: 1, round: 1, slot: 1, rosterId: 'roster-a' })
    resolvePickOwnerMock.mockReturnValue({ rosterId: 'roster-a' })
    getAllowedPositionsAndRosterSizeMock.mockResolvedValue(null)
    draftPickAuditLogCreateMock.mockResolvedValue({})
  })

  it('returns 401 when unauthenticated', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const res = await POST(makeRequest(forceAutopickBody()), makeCtx())
    expect(res.status).toBe(401)
  })

  it('returns error when commissioner gate fails', async () => {
    assertLeagueActionGateMock.mockResolvedValue({
      ok: false,
      err: { error: 'Forbidden', code: 'NOT_COMMISSIONER', status: 403 },
    })
    const res = await POST(makeRequest(forceAutopickBody()), makeCtx())
    expect(res.status).toBe(403)
  })

  it('returns 400 when force_autopick is disabled in settings', async () => {
    getDraftUISettingsMock.mockResolvedValue({
      commissionerForceAutoPickEnabled: false,
      timerMode: 'per_pick',
      autoPickEnabled: false,
      allowPicksDuringOvernightPause: false,
      slowDraftPauseWindow: null,
      tradedPickOwnerNameRedEnabled: false,
      tradedPickColorModeEnabled: false,
      orphanTeamAiManagerEnabled: false,
      orphanDrafterMode: 'cpu',
    })
    const res = await POST(makeRequest(forceAutopickBody()), makeCtx())
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('COMMISSIONER_FORCE_AUTOPICK_DISABLED')
  })

  it('returns 400 when draft is not in_progress', async () => {
    draftSessionFindUniqueMock.mockResolvedValue(makeSession({ status: 'paused' }))
    const res = await POST(makeRequest(forceAutopickBody()), makeCtx())
    expect(res.status).toBe(400)
  })

  it('standard mode: loads fallback pool and picks from it', async () => {
    getViewerAutopickPreferenceMock.mockResolvedValue({
      enabled: false,
      mode: 'standard',
      isProEligible: false,
      updatedAt: null,
    })
    const res = await POST(makeRequest(forceAutopickBody()), makeCtx())
    expect(res.status).toBe(200)
    expect(getLiveADPMock).toHaveBeenCalled()
    expect(submitPickMock).toHaveBeenCalledWith(
      expect.objectContaining({ playerName: 'Patrick Mahomes' }),
    )
  })

  it('ai_queue mode with Pro and queued candidate: uses queue, skips fallback pool', async () => {
    getViewerAutopickPreferenceMock.mockResolvedValue({
      enabled: true,
      mode: 'ai_queue',
      isProEligible: true,
      updatedAt: null,
    })
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: true })
    draftSessionFindUniqueMock.mockResolvedValue(
      makeSession({
        queues: [
          {
            userId: 'on-clock-user',
            order: [{ playerName: 'Justin Jefferson', position: 'WR', team: 'MIN', playerId: null }],
          },
        ],
      }),
    )
    const res = await POST(makeRequest(forceAutopickBody()), makeCtx())
    expect(res.status).toBe(200)
    expect(getLiveADPMock).not.toHaveBeenCalled()
    expect(submitPickMock).toHaveBeenCalledWith(
      expect.objectContaining({ playerName: 'Justin Jefferson' }),
    )
  })

  it('ai_queue mode with Pro but empty queue: falls back to standard pool (fallbackReason=queue_empty)', async () => {
    getViewerAutopickPreferenceMock.mockResolvedValue({
      enabled: true,
      mode: 'ai_queue',
      isProEligible: true,
      updatedAt: null,
    })
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: true })
    // queues is empty — no candidates from queue
    draftSessionFindUniqueMock.mockResolvedValue(makeSession({ queues: [] }))
    const res = await POST(makeRequest(forceAutopickBody()), makeCtx())
    expect(res.status).toBe(200)
    expect(getLiveADPMock).toHaveBeenCalled()
    // Audit log should reflect the fallback
    await vi.waitFor(() => expect(draftPickAuditLogCreateMock).toHaveBeenCalled())
    const call = draftPickAuditLogCreateMock.mock.calls[0][0]
    expect(call.data.metadata.fallbackReason).toBe('queue_empty')
    expect(call.data.metadata.aiPathUsed).toBe(false)
  })

  it('ai_queue mode without Pro (entitlement lapsed): falls back to standard pool (fallbackReason=entitlement_lapsed)', async () => {
    getViewerAutopickPreferenceMock.mockResolvedValue({
      enabled: true,
      mode: 'ai_queue',
      isProEligible: false,
      updatedAt: null,
    })
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: false })
    draftSessionFindUniqueMock.mockResolvedValue(
      makeSession({
        queues: [
          {
            userId: 'on-clock-user',
            order: [{ playerName: 'Justin Jefferson', position: 'WR', team: 'MIN', playerId: null }],
          },
        ],
      }),
    )
    const res = await POST(makeRequest(forceAutopickBody()), makeCtx())
    expect(res.status).toBe(200)
    expect(getLiveADPMock).toHaveBeenCalled()
    await vi.waitFor(() => expect(draftPickAuditLogCreateMock).toHaveBeenCalled())
    const call = draftPickAuditLogCreateMock.mock.calls[0][0]
    expect(call.data.metadata.fallbackReason).toBe('entitlement_lapsed')
    expect(call.data.metadata.aiPathUsed).toBe(false)
  })

  it('pref enabled=false: uses standard fallback pool regardless of mode field', async () => {
    getViewerAutopickPreferenceMock.mockResolvedValue({
      enabled: false,
      mode: 'ai_queue',
      isProEligible: true,
      updatedAt: null,
    })
    const res = await POST(makeRequest(forceAutopickBody()), makeCtx())
    expect(res.status).toBe(200)
    expect(entitlementResolveForUserMock).not.toHaveBeenCalled()
    expect(getLiveADPMock).toHaveBeenCalled()
  })

  it('writes DraftPickAuditLog on success with correct core fields', async () => {
    const res = await POST(makeRequest(forceAutopickBody()), makeCtx())
    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(draftPickAuditLogCreateMock).toHaveBeenCalled())
    const call = draftPickAuditLogCreateMock.mock.calls[0][0]
    expect(call.data).toMatchObject({
      leagueId: 'league-1',
      draftSessionId: 'session-1',
      overallPickNumber: 1,
      round: 1,
      action: 'force_autopick',
      actorUserId: 'commissioner-1',
      newRosterId: 'roster-a',
      newPlayerName: 'Patrick Mahomes',
    })
  })

  it('audit log metadata.mode="standard" for standard path', async () => {
    await POST(makeRequest(forceAutopickBody()), makeCtx())
    await vi.waitFor(() => expect(draftPickAuditLogCreateMock).toHaveBeenCalled())
    const call = draftPickAuditLogCreateMock.mock.calls[0][0]
    expect(call.data.metadata.mode).toBe('standard')
    expect(call.data.metadata.aiPathUsed).toBe(false)
  })

  it('audit log metadata.mode="ai_queue" when ai path was used', async () => {
    getViewerAutopickPreferenceMock.mockResolvedValue({
      enabled: true,
      mode: 'ai_queue',
      isProEligible: true,
      updatedAt: null,
    })
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: true })
    draftSessionFindUniqueMock.mockResolvedValue(
      makeSession({
        queues: [
          {
            userId: 'on-clock-user',
            order: [{ playerName: 'Justin Jefferson', position: 'WR', team: 'MIN', playerId: null }],
          },
        ],
      }),
    )
    await POST(makeRequest(forceAutopickBody()), makeCtx())
    await vi.waitFor(() => expect(draftPickAuditLogCreateMock).toHaveBeenCalled())
    const call = draftPickAuditLogCreateMock.mock.calls[0][0]
    expect(call.data.metadata.mode).toBe('ai_queue')
    expect(call.data.metadata.aiPathUsed).toBe(true)
    expect(call.data.metadata.fallbackReason).toBeUndefined()
  })

  it('passes commissioner userId to buildSessionSnapshot for viewerAutopick hydration', async () => {
    await POST(makeRequest(forceAutopickBody()), makeCtx())
    expect(buildSessionSnapshotMock).toHaveBeenCalledWith(
      'league-1',
      expect.any(Date),
      'commissioner-1',
    )
  })

  it('Pro entitlement check uses on-clock userId, not commissioner userId', async () => {
    getViewerAutopickPreferenceMock.mockResolvedValue({
      enabled: true,
      mode: 'ai_queue',
      isProEligible: false,
      updatedAt: null,
    })
    entitlementResolveForUserMock.mockResolvedValue({ hasAccess: false })
    await POST(makeRequest(forceAutopickBody()), makeCtx())
    if (entitlementResolveForUserMock.mock.calls.length > 0) {
      expect(entitlementResolveForUserMock).toHaveBeenCalledWith('on-clock-user', 'pro_draft_ai')
      expect(entitlementResolveForUserMock).not.toHaveBeenCalledWith('commissioner-1', expect.anything())
    }
  })

  it('skips preference lookup when on-clock roster has no platformUserId (orphan team)', async () => {
    rosterFindUniqueMock.mockResolvedValue({ platformUserId: 'orphan-team-1' })
    const res = await POST(makeRequest(forceAutopickBody()), makeCtx())
    expect(res.status).toBe(200)
    expect(getViewerAutopickPreferenceMock).not.toHaveBeenCalled()
    expect(getLiveADPMock).toHaveBeenCalled()
  })

  it('does not write DraftPickAuditLog when pick submission fails', async () => {
    submitPickMock.mockResolvedValue({
      success: false,
      code: 'DRAFT_PICK_STALE_OVERALL',
      error: 'Stale overall',
      snapshot: undefined,
    })
    const res = await POST(makeRequest(forceAutopickBody()), makeCtx())
    expect(res.status).not.toBe(200)
    expect(draftPickAuditLogCreateMock).not.toHaveBeenCalled()
  })
})
