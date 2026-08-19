import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  assertLeagueActionGate: vi.fn(),
  assertCommissioner: vi.fn(),
  canAccessLeagueDraft: vi.fn(),
  canSubmitPickForRoster: vi.fn(),
  getCurrentUserRosterIdForLeague: vi.fn(),
  isCommissioner: vi.fn(),
  ensureDraftingLifecycleForActiveSession: vi.fn(),
  logAction: vi.fn(),
  submitPick: vi.fn(),
  buildSessionSnapshot: vi.fn(),
  pauseDraftSession: vi.fn(),
  resumeDraftSession: vi.fn(),
  resetTimer: vi.fn(),
  undoLastPick: vi.fn(),
  completeDraftSession: vi.fn(),
  resetDraftSession: vi.fn(),
  setTimerSeconds: vi.fn(),
  startDraftSession: vi.fn(),
  getDraftUISettingsForLeague: vi.fn(),
  getProviderStatus: vi.fn(),
  loadDraftQueueForUser: vi.fn(),
  normalizeDraftQueueSizeLimit: vi.fn(),
  getDraftConfigForLeague: vi.fn(),
  getAllowedPositionsAndRosterSize: vi.fn(),
  prisma: {
    draftSession: {
      findUnique: vi.fn(),
    },
    draftQueue: {
      upsert: vi.fn(),
    },
    roster: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    league: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => mocks.getServerSession(...args),
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/server/services/leagueActionGate', () => ({
  assertLeagueActionGate: (...args: unknown[]) => mocks.assertLeagueActionGate(...args),
}))

vi.mock('@/lib/commissioner/permissions', () => ({
  assertCommissioner: (...args: unknown[]) => mocks.assertCommissioner(...args),
  isCommissioner: (...args: unknown[]) => mocks.isCommissioner(...args),
}))

vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: (...args: unknown[]) => mocks.canAccessLeagueDraft(...args),
  canSubmitPickForRoster: (...args: unknown[]) => mocks.canSubmitPickForRoster(...args),
  getCurrentUserRosterIdForLeague: (...args: unknown[]) => mocks.getCurrentUserRosterIdForLeague(...args),
}))

vi.mock('@/server/services/leagueLifecycleService', () => ({
  ensureDraftingLifecycleForActiveSession: (...args: unknown[]) =>
    mocks.ensureDraftingLifecycleForActiveSession(...args),
}))

vi.mock('@/server/services/auditService', () => ({
  logAction: (...args: unknown[]) => mocks.logAction(...args),
}))

vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({
  submitPick: (...args: unknown[]) => mocks.submitPick(...args),
}))

vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  pauseDraftSession: (...args: unknown[]) => mocks.pauseDraftSession(...args),
  resumeDraftSession: (...args: unknown[]) => mocks.resumeDraftSession(...args),
  resetTimer: (...args: unknown[]) => mocks.resetTimer(...args),
  undoLastPick: (...args: unknown[]) => mocks.undoLastPick(...args),
  completeDraftSession: (...args: unknown[]) => mocks.completeDraftSession(...args),
  resetDraftSession: (...args: unknown[]) => mocks.resetDraftSession(...args),
  buildSessionSnapshot: (...args: unknown[]) => mocks.buildSessionSnapshot(...args),
  setTimerSeconds: (...args: unknown[]) => mocks.setTimerSeconds(...args),
  startDraftSession: (...args: unknown[]) => mocks.startDraftSession(...args),
  getOrCreateDraftSession: vi.fn().mockResolvedValue({
    session: { id: 'session-1', leagueId: 'league-1', status: 'pre_draft' },
    created: true,
  }),
}))

vi.mock('@/lib/live-draft-engine/RosterAssignmentService', () => ({
  appendPickToRosterDraftSnapshot: vi.fn().mockResolvedValue(null),
  finalizeRosterAssignments: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/draft-notifications', () => ({
  notifyDraftIntelOnClockUrgent: vi.fn().mockResolvedValue(null),
  notifyDraftIntelPickConfirmation: vi.fn().mockResolvedValue(null),
  notifyDraftIntelPlayerTaken: vi.fn().mockResolvedValue(null),
  notifyDraftIntelQueueReady: vi.fn().mockResolvedValue(null),
  notifyDraftIntelTierBreak: vi.fn().mockResolvedValue(null),
  notifyOnTheClockAfterPick: vi.fn().mockResolvedValue(null),
  notifyDraftStartingSoon: vi.fn().mockResolvedValue(null),
  notifyDraftPaused: vi.fn().mockResolvedValue(null),
  notifyDraftResumed: vi.fn().mockResolvedValue(null),
  notifyDraftIntelPostDraftRecap: vi.fn().mockResolvedValue(null),
  notifyDraftIntelOrphanTeamPick: vi.fn().mockResolvedValue(null),
  getLeagueMemberAppUserIds: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/draft-intelligence', () => ({
  publishDraftIntelForUpcomingManagers: vi.fn().mockResolvedValue([]),
  sendDraftIntelDm: vi.fn().mockResolvedValue(null),
  publishDraftIntelRecap: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: (...args: unknown[]) => mocks.getDraftUISettingsForLeague(...args),
}))

vi.mock('@/lib/provider-config', () => ({
  getProviderStatus: (...args: unknown[]) => mocks.getProviderStatus(...args),
}))

vi.mock('@/lib/draft-room/loadDraftQueueForUser', () => ({
  loadDraftQueueForUser: (...args: unknown[]) => mocks.loadDraftQueueForUser(...args),
}))

vi.mock('@/lib/draft-defaults/DraftQueueLimitResolver', () => ({
  normalizeDraftQueueSizeLimit: (...args: unknown[]) => mocks.normalizeDraftQueueSizeLimit(...args),
  trimDraftQueue: (queue: unknown[], limit: number) =>
    Array.isArray(queue) ? queue.slice(0, Math.max(0, Number(limit) || 0)) : [],
}))

vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: (...args: unknown[]) => mocks.getDraftConfigForLeague(...args),
}))

vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({
  getAllowedPositionsAndRosterSize: (...args: unknown[]) => mocks.getAllowedPositionsAndRosterSize(...args),
}))

vi.mock('@/lib/draft-room/draft-pool-eligible-positions', () => ({
  draftPoolRowMatchesEligiblePositions: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/live-draft-engine/CurrentOnTheClockResolver', () => ({
  resolveCurrentOnTheClock: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/live-draft-engine/draftPickEmpty', () => ({
  isDraftPickRowEmpty: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/live-draft-engine/PickOwnershipResolver', () => ({
  resolvePickOwner: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/adp-data', () => ({
  getLiveADP: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({
  getPlayerPoolForLeague: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({
  getOrphanRosterIdsForLeague: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/live-draft-engine/auction/AuctionEngine', () => ({
  resolveAuctionWin: vi.fn().mockResolvedValue({ ok: false }),
}))

vi.mock('@/lib/live-draft-engine/auction', () => ({
  runAuctionAutomationTick: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/live-draft-engine/keeper', () => ({
  runKeeperAutomationTick: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService', () => ({
  runSlowDraftAutomationTick: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/draft-lottery/lotteryConfigStorage', () => ({
  getDraftOrderModeAndLotteryConfig: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/api-performance', () => ({
  dedupeInFlight: async (_key: string, fn: () => Promise<unknown>) => fn(),
}))

vi.mock('@/lib/live-draft-engine/postDraftFinalizeArtifacts', () => ({
  repairDraftCompletionIfBoardFull: vi.fn().mockResolvedValue(null),
  syncPostDraftArtifactsIfCompletedThrottled: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/draft/getCanonicalDraftState', () => ({
  getCanonicalDraftState: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/ai/events/recordAiEvent', () => ({
  recordAiEvent: vi.fn(),
}))

vi.mock('@/lib/ai/events/aiEventTypes', () => ({
  AI_EVENT_TYPES: {
    AUTO_PICK_MADE: 'AUTO_PICK_MADE',
    DRAFT_PICK_MADE: 'DRAFT_PICK_MADE',
  },
}))

vi.mock('@/lib/league-events/publisher', () => ({
  publishLeagueFanoutEvent: vi.fn().mockResolvedValue(null),
}))

import { POST as postDraftControls } from '@/app/api/leagues/[leagueId]/draft/controls/route'
import { POST as postDraftPick } from '@/app/api/leagues/[leagueId]/draft/pick/route'
import { PUT as putDraftQueue } from '@/app/api/leagues/[leagueId]/draft/queue/route'
import { POST as postDraftSession } from '@/app/api/leagues/[leagueId]/draft/session/route'

function jsonRequest(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any
}

describe('Phase 4 Slice 3 - permission and guardrail mechanics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getServerSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.assertLeagueActionGate.mockResolvedValue({ ok: true })
    mocks.assertCommissioner.mockResolvedValue(undefined)
    mocks.canAccessLeagueDraft.mockResolvedValue(true)
    mocks.canSubmitPickForRoster.mockResolvedValue(true)
    mocks.getCurrentUserRosterIdForLeague.mockResolvedValue('roster-member-1')
    mocks.isCommissioner.mockResolvedValue(false)
    mocks.ensureDraftingLifecycleForActiveSession.mockResolvedValue(undefined)
    mocks.logAction.mockResolvedValue(undefined)
    mocks.submitPick.mockResolvedValue({
      success: true,
      snapshot: { overall: 1, round: 1, rosterId: 'roster-member-1' },
    })
    mocks.buildSessionSnapshot.mockResolvedValue({
      status: 'in_progress',
      currentPick: { rosterId: 'roster-member-1' },
      picks: [],
    })
    mocks.pauseDraftSession.mockResolvedValue(true)
    mocks.resumeDraftSession.mockResolvedValue(true)
    mocks.resetTimer.mockResolvedValue(true)
    mocks.undoLastPick.mockResolvedValue(true)
    mocks.completeDraftSession.mockResolvedValue(true)
    mocks.resetDraftSession.mockResolvedValue(true)
    mocks.setTimerSeconds.mockResolvedValue(true)
    mocks.startDraftSession.mockResolvedValue({ ok: true })
    mocks.getDraftUISettingsForLeague.mockResolvedValue({
      commissionerPauseControlsEnabled: true,
      commissionerForceAutoPickEnabled: true,
      orphanTeamAiManagerEnabled: true,
      orphanDrafterMode: 'cpu',
    })
    mocks.getProviderStatus.mockReturnValue({ anyAi: true })
    mocks.loadDraftQueueForUser.mockResolvedValue({ queue: [], removedUnavailable: 0 })
    mocks.normalizeDraftQueueSizeLimit.mockReturnValue(40)
    mocks.getDraftConfigForLeague.mockResolvedValue({ queue_size_limit: 40 })
    mocks.getAllowedPositionsAndRosterSize.mockResolvedValue(null)
    mocks.prisma.draftSession.findUnique.mockResolvedValue({ id: 'session-1', picks: [] })
    mocks.prisma.draftQueue.upsert.mockResolvedValue(null)
    mocks.prisma.roster.findUnique.mockResolvedValue({ platformUserId: 'user-1' })
    mocks.prisma.roster.findFirst.mockResolvedValue({ id: 'roster-member-1', platformUserId: 'user-1' })
    mocks.prisma.league.findUnique.mockResolvedValue({ sport: 'NFL' })
  })

  it('non-commissioner cannot start draft session via POST', async () => {
    mocks.assertCommissioner.mockRejectedValue(new Error('forbidden'))

    const res = await postDraftSession(jsonRequest('http://localhost/api/leagues/league-1/draft/session', { action: 'start' }), {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({ error: 'Forbidden' })
  })

  it('non-commissioner cannot execute commissioner-only controls', async () => {
    mocks.assertLeagueActionGate.mockResolvedValue({
      ok: false,
      err: { status: 403, error: 'Forbidden', code: 'FORBIDDEN' },
    })

    const actions = ['pause', 'resume', 'reset_timer', 'undo_pick', 'skip_pick', 'force_autopick']

    for (const action of actions) {
      const res = await postDraftControls(
        jsonRequest('http://localhost/api/leagues/league-1/draft/controls', { action }),
        { params: Promise.resolve({ leagueId: 'league-1' }) },
      )
      const body = await res.json()
      expect(res.status).toBe(403)
      expect(body?.code).toBe('FORBIDDEN')
    }
  })

  it('commissioner can pause draft when pause controls are enabled', async () => {
    const res = await postDraftControls(
      jsonRequest('http://localhost/api/leagues/league-1/draft/controls', { action: 'pause' }),
      { params: Promise.resolve({ leagueId: 'league-1' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body?.ok).toBe(true)
    expect(body?.action).toBe('pause')
    expect(mocks.pauseDraftSession).toHaveBeenCalledWith('league-1', 'user-1')
  })

  it('commissioner pause is rejected when pause controls are disabled', async () => {
    mocks.getDraftUISettingsForLeague.mockResolvedValue({
      commissionerPauseControlsEnabled: false,
      commissionerForceAutoPickEnabled: true,
    })

    const res = await postDraftControls(
      jsonRequest('http://localhost/api/leagues/league-1/draft/controls', { action: 'pause' }),
      { params: Promise.resolve({ leagueId: 'league-1' }) },
    )
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(String(body?.error ?? '')).toContain('disabled')
  })

  it('member can submit a pick only for current on-clock roster', async () => {
    mocks.buildSessionSnapshot
      .mockResolvedValueOnce({
        status: 'in_progress',
        currentPick: { rosterId: 'roster-member-1' },
      })
      .mockResolvedValueOnce({
        status: 'in_progress',
        picks: [{ overall: 1, playerName: 'Valid Pick', position: 'RB', rosterId: 'roster-member-1' }],
      })

    const req = jsonRequest('http://localhost/api/leagues/league-1/draft/pick', {
      playerName: 'Valid Pick',
      position: 'RB',
      rosterId: 'roster-member-1',
    })

    const res = await postDraftPick(req, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body?.ok).toBe(true)
    expect(mocks.submitPick).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'league-1',
        rosterId: 'roster-member-1',
        source: 'user',
      }),
    )
  })

  it('member cannot submit pick for a different roster than on-clock roster', async () => {
    mocks.buildSessionSnapshot.mockResolvedValue({
      status: 'in_progress',
      currentPick: { rosterId: 'roster-member-1' },
    })

    const req = jsonRequest('http://localhost/api/leagues/league-1/draft/pick', {
      playerName: 'Invalid Pick',
      position: 'WR',
      rosterId: 'roster-other',
    })

    const res = await postDraftPick(req, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })
    const body = await res.json()

    // Commit M — authority refusal now returns 403 with the structured
    // `DRAFT_PICK_NOT_ON_CLOCK` code (was a generic 400). Status reflects
    // the "Forbidden" semantics; the error string + submitPick-not-called
    // contract stays unchanged.
    expect(res.status).toBe(403)
    expect(body?.code).toBe('DRAFT_PICK_NOT_ON_CLOCK')
    expect(String(body?.error ?? '')).toContain('Invalid roster')
    expect(mocks.submitPick).not.toHaveBeenCalled()
  })

  it('queue mutation is always scoped to authenticated caller userId', async () => {
    const req = new Request('http://localhost/api/leagues/league-1/draft/queue', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'someone-else',
        queue: [{ playerName: 'Queue RB', position: 'RB', team: 'A' }],
      }),
    }) as any

    const res = await putDraftQueue(req, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    })

    expect(res.status).toBe(200)
    expect(mocks.prisma.draftQueue.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId_userId: { sessionId: 'session-1', userId: 'user-1' } },
        create: expect.objectContaining({ userId: 'user-1' }),
      }),
    )
  })
})

describe('Phase 4 Slice 3 - AI and War Room entitlement boundaries', () => {
  const draftRoomClientPath = path.join(process.cwd(), 'components/app/draft-room/DraftRoomPageClient.tsx')

  it('AI access gate is subscription OR token-balance based', () => {
    const src = fs.readFileSync(draftRoomClientPath, 'utf8')
    expect(src).toContain('const hasAiAccess = hasAiSubscription || tokenBalance.balance > 0')
  })

  it('AI panel renders locked-state copy when AI access is unavailable', () => {
    const src = fs.readFileSync(draftRoomClientPath, 'utf8')
    expect(src).toContain('data-testid="draft-bottom-ai-locked"')
    // Customer-facing copy dropped "AI" (tier/pricing copy must never say "AI") — see planIncludes.ts.
    expect(src).toContain('Recommendations locked')
  })

  it('War Room popup mount is not entitlement-gated in current client logic', () => {
    const src = fs.readFileSync(draftRoomClientPath, 'utf8')
    expect(src).toContain('<WarRoomPopup hasNewIntel={warRoomHasNewIntel} triggerLabel="War Room">')
  })
})
