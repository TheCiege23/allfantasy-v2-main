import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"
const getServerSessionMock = vi.fn()
const canAccessLeagueDraftMock = vi.fn()
const getCurrentUserRosterIdForLeagueMock = vi.fn()
const getDraftSessionByLeagueMock = vi.fn()
const resolvePickOwnerMock = vi.fn()
const isCommissionerMock = vi.fn()
const isDraftPickTradingAllowedForLeagueMock = vi.fn()
const getDraftUISettingsForLeagueMock = vi.fn()
const dispatchNotificationMock = vi.fn()
const gradeMock = vi.fn()
const createLeagueTradeGraderMock = vi.fn(async () => ({ grade: gradeMock }))
const sendPrivateTradeAIDMMock = vi.fn()
const createDraftNotificationMock = vi.fn()
const getAppUserIdForRosterMock = vi.fn()
const notifyDraftAiTradeReviewAvailableMock = vi.fn()
const openaiChatTextMock = vi.fn()
const getProviderStatusMock = vi.fn()
const evaluateAIInvocationPolicyMock = vi.fn()
const buildDraftExecutionMetadataMock = vi.fn()
const withTimeoutMock = vi.fn()

const prismaMock = {
  draftPickTradeProposal: {
    create: vi.fn(),
    findFirst: vi.fn(),
  },
  league: {
    findUnique: vi.fn(),
  },
}

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: canAccessLeagueDraftMock,
  getCurrentUserRosterIdForLeague: getCurrentUserRosterIdForLeagueMock,
}))

vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  getDraftSessionByLeague: getDraftSessionByLeagueMock,
}))

vi.mock('@/lib/live-draft-engine/PickOwnershipResolver', () => ({
  resolvePickOwner: resolvePickOwnerMock,
}))

vi.mock('@/lib/commissioner/permissions', () => ({
  isCommissioner: isCommissionerMock,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/tournament-mode/safety', () => ({
  isDraftPickTradingAllowedForLeague: isDraftPickTradingAllowedForLeagueMock,
}))

vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({
  getDraftUISettingsForLeague: getDraftUISettingsForLeagueMock,
}))

vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: dispatchNotificationMock,
}))

// THE grade is the draft-room verdict (2026-11-26): the grader is the only double; the review is real.
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({
  createLeagueTradeGrader: createLeagueTradeGraderMock,
  gradeDeal: async (grader: any, args: any) => grader.grade({ give: args.give.assets, get: args.get.assets, viewerSide: args.viewerSide }),
}))

const gradedView = (action: string, letter: string, partnerLetter: string, recommendation: string) => ({
  graded: true, letter, partnerLetter, label: 'Slightly favors opponent', action,
  giveValue: 5000, getValue: 4200, recommendation,
})

vi.mock('@/lib/trade-ai-dm/TradeAIDMService', () => ({
  sendPrivateTradeAIDM: sendPrivateTradeAIDMMock,
}))

vi.mock('@/lib/draft-notifications', () => ({
  createDraftNotification: createDraftNotificationMock,
  getAppUserIdForRoster: getAppUserIdForRosterMock,
  notifyDraftAiTradeReviewAvailable: notifyDraftAiTradeReviewAvailableMock,
}))

const openaiChatJsonMock = vi.fn()

vi.mock('@/lib/openai-client', () => ({
  openaiChatText: openaiChatTextMock,
  openaiChatJson: openaiChatJsonMock,
  parseJsonContentFromChatCompletion: vi.fn(),
}))

vi.mock('@/lib/provider-config', () => ({
  getProviderStatus: getProviderStatusMock,
}))

vi.mock('@/lib/draft-automation-policy', () => ({
  evaluateAIInvocationPolicy: evaluateAIInvocationPolicyMock,
  buildDraftExecutionMetadata: buildDraftExecutionMetadataMock,
  withTimeout: withTimeoutMock,
}))

vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    async resolveForUser(_userId: string, _feature: string) {
      return { hasAccess: false }
    }
  },
}))

// Warm the route's module graph once, before any test. Its first import compiles a large graph — over
// 10s on an idle machine — and with the other chat and Chimmy suites running alongside it passed 30s,
// so the FIRST test timed out (and its call, still running, could take the next test's mocks).
// Paid here, the 30s test limit measures only the test. The warm-up's own limit is generous because this is
// compile time, not a hang: on a box busy with other type-checks, this one import has taken over 2 minutes.
beforeAll(async () => { await import('@/app/api/leagues/[leagueId]/draft/trade-proposals/route') }, 300_000)

describe('Draft trade AI DM system contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends private AI DM when trade proposal is received', async () => {
    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'user-1' } })
    canAccessLeagueDraftMock.mockResolvedValueOnce(true)
    getCurrentUserRosterIdForLeagueMock.mockResolvedValueOnce('roster-1')
    isDraftPickTradingAllowedForLeagueMock.mockResolvedValueOnce(true)
    getDraftUISettingsForLeagueMock.mockResolvedValueOnce({ pickTradeEnabled: true })
    getDraftSessionByLeagueMock.mockResolvedValueOnce({
      id: 'session-1',
      status: 'in_progress',
      rounds: 8,
      teamCount: 2,
      draftType: 'snake',
      thirdRoundReversal: false,
      draftModeLabel: 'rookie',
      startedAt: new Date('2026-05-01T00:00:00.000Z'),
      slotOrder: [
        { slot: 1, rosterId: 'roster-1', displayName: 'Manager One' },
        { slot: 2, rosterId: 'roster-2', displayName: 'Manager Two' },
      ],
      tradedPicks: [],
      picks: [],
    })
    resolvePickOwnerMock.mockImplementation((_round: number, slot: number) =>
      slot === 1
        ? { rosterId: 'roster-1', displayName: 'Manager One' }
        : { rosterId: 'roster-2', displayName: 'Manager Two' }
    )
    ;(prismaMock.draftPickTradeProposal.create as any).mockResolvedValueOnce({
      id: 'tp-1',
      giveRound: 1,
      giveSlot: 1,
      receiveRound: 2,
      receiveSlot: 2,
      receiverRosterId: 'roster-2',
      status: 'pending',
      createdAt: new Date('2026-03-30T00:00:00.000Z'),
    })
    getAppUserIdForRosterMock.mockResolvedValueOnce('user-2')
    ;(prismaMock.league.findUnique as any).mockResolvedValueOnce({ name: 'League One' })
    gradeMock.mockResolvedValueOnce(gradedView('counter', 'D', 'B', 'Favors the other side on league value. A counter needs about 800 more coming back to reach even.'))
    sendPrivateTradeAIDMMock.mockResolvedValueOnce({
      sent: true,
      threadId: 'ai-thread-1',
      counterSuggestion: 'Ask for a future middle-round pick.',
    })

    const { POST } = await import('@/app/api/leagues/[leagueId]/draft/trade-proposals/route')
    const req = createMockNextRequest('http://localhost/api/leagues/league-1/draft/trade-proposals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        giveRound: 1,
        giveSlot: 1,
        receiveRound: 2,
        receiveSlot: 2,
        receiverRosterId: 'roster-2',
        receiverName: 'Manager Two',
      }),
    })

    const res = await POST(req as any, {
      params: Promise.resolve({ leagueId: 'league-1' }),
    } as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.privateAiDmSent).toBe(true)
    expect(body.privateAiDmCounterSuggestion).toBe('Ask for a future middle-round pick.')
    expect(sendPrivateTradeAIDMMock).toHaveBeenCalledWith(
      expect.objectContaining({
        receiverUserId: 'user-2',
        leagueId: 'league-1',
        proposalId: 'tp-1',
        trigger: 'trade_received',
      })
    )
    // The DM's verdict, summary and counter reason are the grade's — and the receiver's side was graded.
    const dm = sendPrivateTradeAIDMMock.mock.calls[0][0]
    expect(dm.review.verdict).toBe('counter')
    expect(dm.review.summary).toMatch(/^Favors the other side on league value/)
    expect(dm.review.counterReasons).toEqual([dm.review.summary])
    const graded = gradeMock.mock.calls[0][0]
    expect(graded.give[0]).toMatchObject({ kind: 'pick', round: 2 })
    expect(graded.get[0]).toMatchObject({ kind: 'pick', round: 1 })
  })

  it('returns private AI DM metadata for review responses with counter suggestion', async () => {
    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'receiver-user' } })
    canAccessLeagueDraftMock.mockResolvedValueOnce(true)
    getCurrentUserRosterIdForLeagueMock.mockResolvedValueOnce('roster-2')
    getDraftSessionByLeagueMock.mockResolvedValueOnce({
      id: 'session-1',
      status: 'in_progress',
      rounds: 8,
      teamCount: 12,
      draftType: 'snake',
      thirdRoundReversal: false,
      draftModeLabel: 'rookie',
      startedAt: new Date('2026-05-01T00:00:00.000Z'),
      slotOrder: [
        { slot: 1, rosterId: 'roster-1', displayName: 'Manager One' },
        { slot: 2, rosterId: 'roster-2', displayName: 'Manager Two' },
      ],
      tradedPicks: [],
      picks: [],
    })
    resolvePickOwnerMock.mockImplementation((_round: number, slot: number) =>
      slot === 1
        ? { rosterId: 'roster-1', displayName: 'Manager One' }
        : { rosterId: 'roster-2', displayName: 'Manager Two' }
    )
    ;(prismaMock.draftPickTradeProposal.findFirst as any).mockResolvedValueOnce({
      id: 'tp-1',
      proposerRosterId: 'roster-1',
      receiverRosterId: 'roster-2',
      status: 'pending',
      giveRound: 1,
      giveSlot: 1,
      receiveRound: 2,
      receiveSlot: 2,
      session: { leagueId: 'league-1', teamCount: 12 },
    })
    // Receiver gives 2.02 (overall 23) for 1.01: the old distance rule called that ACCEPT. The grade says decline.
    gradeMock.mockResolvedValueOnce(gradedView('decline', 'F', 'A', 'An overpay on league value — about 3,000 short. Decline, or ask for substantially more.'))
    getProviderStatusMock.mockReturnValueOnce({ anyAi: false })
    evaluateAIInvocationPolicyMock.mockReturnValueOnce({
      decision: 'deterministic_only',
      reasonCode: 'deterministic_only',
      canShowAIButton: true,
      maxLatencyMs: 1200,
    })
    buildDraftExecutionMetadataMock.mockReturnValueOnce({
      mode: 'deterministic',
      fallbackToDeterministic: false,
    })
    sendPrivateTradeAIDMMock.mockResolvedValueOnce({
      sent: true,
      threadId: 'ai-thread-2',
      counterSuggestion: 'Ask for one extra future pick.',
    })

    const { POST } = await import('@/app/api/leagues/[leagueId]/draft/trade-proposals/[proposalId]/review/route')
    const req = createMockNextRequest(
      'http://localhost/api/leagues/league-1/draft/trade-proposals/tp-1/review',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeAiExplanation: false }),
      }
    )

    const res = await POST(req as any, {
      params: Promise.resolve({ leagueId: 'league-1', proposalId: 'tp-1' }),
    } as any)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.private).toBe(true)
    expect(body.privateAiDmSent).toBe(true)
    expect(body.privateAiDmCounterSuggestion).toBe('Ask for one extra future pick.')
    expect(body.verdict).toBe('reject')
    expect(body.tradeGrade).toMatchObject({ graded: true, letter: 'F', partnerLetter: 'A', action: 'decline' })
    expect(body.declineReasons).toEqual([body.summary])
    expect(body.structuredAnalysis).toEqual({ overallDelta: -22, moveDirection: 'up' })
    expect(sendPrivateTradeAIDMMock).toHaveBeenCalledWith(
      expect.objectContaining({
        receiverUserId: 'receiver-user',
        leagueId: 'league-1',
        proposalId: 'tp-1',
        trigger: 'review_requested',
      })
    )
  })
})
