/**
 * P1.2 — POST /api/leagues/[leagueId]/draft/autopick-expired — route contract.
 *
 * Behaviors locked here:
 *   1. Route file exists and POST handler is exported.
 *   2. 401 when not authenticated.
 *   3. 403 when user cannot access the draft (canAccessLeagueDraft = false).
 *   4. 403 when user has no roster in the league.
 *   5. 400 when draft is not in_progress.
 *   6. 400 when auto-pick is disabled in UI settings.
 *   7. 400 when the requesting user is not on the clock (DRAFT_PICK_NOT_ON_CLOCK).
 *   8. submitPick is called when a valid autopick candidate is found.
 *   9. Route returns ok:true with pick/strategy/session on success.
 *  10. The route never touches the legacy autopick endpoint.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const getServerSessionMock = vi.hoisted(() =>
  vi.fn(async () => null as null | { user?: { id?: string } }),
)
const canAccessLeagueDraftMock = vi.hoisted(() => vi.fn(async () => true))
const getCurrentUserRosterIdForLeagueMock = vi.hoisted(() =>
  vi.fn(async () => 'roster-user-1' as string | null),
)
const draftSessionFindUniqueMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: 'session-1',
    status: 'in_progress',
    draftType: 'snake',
    rounds: 4,
    teamCount: 2,
    thirdRoundReversal: false,
    timerSeconds: 90,
    timerEndAt: null,
    slotOrder: [
      { slot: 1, rosterId: 'roster-user-1', displayName: 'Team A' },
      { slot: 2, rosterId: 'roster-b', displayName: 'Team B' },
    ],
    tradedPicks: [],
    sportType: 'NFL',
    playerPool: 'all',
    picks: [],
    queues: [],
  } as object | null)),
)
const getDraftUISettingsMock = vi.hoisted(() =>
  vi.fn(async () => ({
    autoPickEnabled: true,
    commissionerPauseControlsEnabled: true,
    commissionerForceAutoPickEnabled: true,
    orphanTeamAiManagerEnabled: false,
    orphanDrafterMode: 'cpu' as const,
  })),
)
const getDraftConfigMock = vi.hoisted(() =>
  vi.fn(async () => ({ autopick_behavior: 'queue-first' } as object | null)),
)
const submitPickMock = vi.hoisted(() =>
  vi.fn(async () => ({
    success: true,
    snapshot: {
      rosterId: 'roster-user-1',
      playerName: 'Justin Jefferson',
      position: 'WR',
      overall: 1,
    },
  })),
)
const resolveBestAvailableMock = vi.hoisted(() =>
  vi.fn(async () => ({
    playerName: 'Justin Jefferson',
    position: 'WR',
    team: 'MIN',
    playerId: 'p-1',
    byeWeek: null,
    reason: 'Best available',
    strategy: 'bpa' as const,
  })),
)
const buildSessionSnapshotMock = vi.hoisted(() => vi.fn(async () => null))

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSessionMock(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: (...a: [string, string]) => canAccessLeagueDraftMock(...a),
  getCurrentUserRosterIdForLeague: (...a: [string, string]) =>
    getCurrentUserRosterIdForLeagueMock(...a),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: {
      findFirst: (...a: unknown[]) => draftSessionFindUniqueMock(...a),
      findUnique: (...a: unknown[]) => draftSessionFindUniqueMock(...a),
    },
  },
}))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: (...a: [string]) => getDraftUISettingsMock(...a),
}))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: (...a: [string]) => getDraftConfigMock(...a),
}))
vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({
  submitPick: (...a: Parameters<typeof submitPickMock>) => submitPickMock(...a),
}))
vi.mock('@/lib/live-draft-engine/autopickBestAvailableSubmit', () => ({
  resolveBestAvailableAutopickCandidate: (...a: [string, string]) => resolveBestAvailableMock(...a),
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  buildSessionSnapshot: (...a: unknown[]) => buildSessionSnapshotMock(...a),
}))
vi.mock('@/lib/live-draft-engine/RosterAssignmentService', () => ({
  appendPickToRosterDraftSnapshot: vi.fn(async () => {}),
}))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({
  getAllowedPositionsAndRosterSize: vi.fn(async () => ({
    draftEligiblePositions: null,
  })),
}))
vi.mock('@/lib/draft-room/draft-pool-eligible-positions', () => ({
  filterEntriesByDraftEligiblePositions: (entries: unknown[]) => entries,
}))
vi.mock('@/lib/draft-notifications', () => ({
  notifyAutoPickFired: vi.fn(async () => {}),
  notifyOnTheClockAfterPick: vi.fn(async () => {}),
  notifyQueuePlayerUnavailable: vi.fn(async () => {}),
  notifyDraftIntelPickConfirmation: vi.fn(async () => {}),
  notifyDraftIntelPlayerTaken: vi.fn(async () => {}),
  notifyDraftIntelQueueReady: vi.fn(async () => {}),
  notifyDraftIntelTierBreak: vi.fn(async () => {}),
  notifyDraftIntelOnClockUrgent: vi.fn(async () => {}),
}))
vi.mock('@/lib/draft-intelligence', () => ({
  publishDraftIntelForUpcomingManagers: vi.fn(async () => []),
  sendDraftIntelDm: vi.fn(async () => {}),
}))
vi.mock('@/lib/live-draft-engine/CurrentOnTheClockResolver', () => ({
  resolveCurrentOnTheClock: vi.fn(() => ({
    overall: 1,
    round: 1,
    slot: 1,
    rosterId: 'roster-user-1',
  })),
}))
vi.mock('@/lib/live-draft-engine/PickOwnershipResolver', () => ({
  resolvePickOwner: vi.fn(() => ({ rosterId: 'roster-user-1' })),
}))
vi.mock('@/lib/ai/opponents/liveDraftAiAutopick', () => ({
  tryAiOpponentAutopickForExpiredTimer: vi.fn(async () => ({ ok: false })),
}))

// ---------------------------------------------------------------------------
// Import route under test
// ---------------------------------------------------------------------------

const { POST } = await import(
  '@/app/api/leagues/[leagueId]/draft/autopick-expired/route'
)

function makeReq(leagueId = 'league-1'): [NextRequest, { params: Promise<{ leagueId: string }> }] {
  const url = `http://localhost/api/leagues/${leagueId}/draft/autopick-expired`
  return [
    new NextRequest(url, { method: 'POST' }),
    { params: Promise.resolve({ leagueId }) },
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
  canAccessLeagueDraftMock.mockResolvedValue(true)
  getCurrentUserRosterIdForLeagueMock.mockResolvedValue('roster-user-1')
  draftSessionFindUniqueMock.mockResolvedValue({
    id: 'session-1',
    status: 'in_progress',
    draftType: 'snake',
    rounds: 4,
    teamCount: 2,
    thirdRoundReversal: false,
    timerSeconds: 90,
    timerEndAt: null,
    slotOrder: [
      { slot: 1, rosterId: 'roster-user-1', displayName: 'Team A' },
      { slot: 2, rosterId: 'roster-b', displayName: 'Team B' },
    ],
    tradedPicks: [],
    sportType: 'NFL',
    playerPool: 'all',
    picks: [],
    queues: [],
  })
  getDraftUISettingsMock.mockResolvedValue({ autoPickEnabled: true })
  getDraftConfigMock.mockResolvedValue({ autopick_behavior: 'queue-first' })
  submitPickMock.mockResolvedValue({
    success: true,
    snapshot: {
      rosterId: 'roster-user-1',
      playerName: 'Justin Jefferson',
      position: 'WR',
      overall: 1,
    },
  })
  resolveBestAvailableMock.mockResolvedValue({
    playerName: 'Justin Jefferson',
    position: 'WR',
    team: 'MIN',
    playerId: 'p-1',
    byeWeek: null,
    reason: 'Best available',
    strategy: 'bpa',
  })
})

// ---------------------------------------------------------------------------
// 1. Route file exports POST
// ---------------------------------------------------------------------------

describe('Behavior 1: route exports a POST handler', () => {
  it('POST is a function', () => {
    expect(typeof POST).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// 2. 401 when unauthenticated
// ---------------------------------------------------------------------------

describe('Behavior 2: 401 when not authenticated', () => {
  it('returns 401 when session is null', async () => {
    getServerSessionMock.mockResolvedValueOnce(null)
    const [req, ctx] = makeReq()
    const res = await POST(req, ctx)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })
})

// ---------------------------------------------------------------------------
// 3. 403 when canAccessLeagueDraft returns false
// ---------------------------------------------------------------------------

describe('Behavior 3: 403 when user cannot access league draft', () => {
  it('returns 403 Forbidden', async () => {
    canAccessLeagueDraftMock.mockResolvedValueOnce(false)
    const [req, ctx] = makeReq()
    const res = await POST(req, ctx)
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// 4. 403 when user has no roster in the league
// ---------------------------------------------------------------------------

describe('Behavior 4: 403 when no roster found for user', () => {
  it('returns 403 with roster error', async () => {
    getCurrentUserRosterIdForLeagueMock.mockResolvedValueOnce(null)
    const [req, ctx] = makeReq()
    const res = await POST(req, ctx)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/roster/i)
  })
})

// ---------------------------------------------------------------------------
// 5. 400 when draft is not in_progress
// ---------------------------------------------------------------------------

describe('Behavior 5: 400 when draft is not in progress', () => {
  it('returns 400 for paused draft', async () => {
    draftSessionFindUniqueMock.mockResolvedValueOnce({
      id: 'session-1',
      status: 'paused',
      picks: [],
      queues: [],
    })
    const [req, ctx] = makeReq()
    const res = await POST(req, ctx)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not in progress/i)
  })

  it('returns 400 when draftSession is null', async () => {
    draftSessionFindUniqueMock.mockResolvedValueOnce(null)
    const [req, ctx] = makeReq()
    const res = await POST(req, ctx)
    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// 6. 400 when auto-pick is disabled by commissioner
// ---------------------------------------------------------------------------

describe('Behavior 6: 400 when auto-pick disabled in UI settings', () => {
  it('returns 400 with autoPickEnabled=false', async () => {
    getDraftUISettingsMock.mockResolvedValueOnce({ autoPickEnabled: false })
    const [req, ctx] = makeReq()
    const res = await POST(req, ctx)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/auto-pick is disabled/i)
  })
})

// ---------------------------------------------------------------------------
// 7. 400 (DRAFT_PICK_NOT_ON_CLOCK) when user is not on the clock
// ---------------------------------------------------------------------------

describe('Behavior 7: DRAFT_PICK_NOT_ON_CLOCK when user is not on clock', () => {
  it('returns 409 / 400-range when requesting user is not on the clock', async () => {
    // rosterId for user = 'roster-user-1', but on-clock is 'roster-b'
    getCurrentUserRosterIdForLeagueMock.mockResolvedValueOnce('roster-user-1')
    const { resolvePickOwner } = await import('@/lib/live-draft-engine/PickOwnershipResolver')
    vi.mocked(resolvePickOwner).mockReturnValueOnce({ rosterId: 'roster-b' } as ReturnType<typeof resolvePickOwner>)
    const [req, ctx] = makeReq()
    const res = await POST(req, ctx)
    // 409 = httpStatusForPickAuthorityCode(DRAFT_PICK_NOT_ON_CLOCK)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    const body = await res.json()
    expect(body.code).toBe('DRAFT_PICK_NOT_ON_CLOCK')
  })
})

// ---------------------------------------------------------------------------
// 8. submitPick is called on success path
// ---------------------------------------------------------------------------

describe('Behavior 8: submitPick called with autopick candidate', () => {
  it('calls submitPick with the best-available candidate', async () => {
    const [req, ctx] = makeReq()
    await POST(req, ctx)
    expect(submitPickMock).toHaveBeenCalledOnce()
    const [callArgs] = submitPickMock.mock.calls
    expect(callArgs[0].playerName).toBe('Justin Jefferson')
    expect(callArgs[0].position).toBe('WR')
    expect(callArgs[0].source).toBe('auto')
  })
})

// ---------------------------------------------------------------------------
// 9. ok:true with strategy/session on success
// ---------------------------------------------------------------------------

describe('Behavior 9: success response shape', () => {
  it('returns ok:true with submittedPlayerName and strategy', async () => {
    const [req, ctx] = makeReq()
    const res = await POST(req, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.submittedPlayerName).toBe('Justin Jefferson')
    expect(body.strategy).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 10. No legacy endpoint references
// ---------------------------------------------------------------------------

describe('Behavior 10: no legacy endpoint references in route source', () => {
  it('route does not reference /api/draft/autopick/toggle', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const routeSrc = readFileSync(
      resolve(process.cwd(), 'app/api/leagues/[leagueId]/draft/autopick-expired/route.ts'),
      'utf8',
    )
    expect(routeSrc).not.toMatch(/\/api\/draft\/autopick\/toggle/)
    expect(routeSrc).not.toMatch(/\/api\/draft\/room/)
  })
})
