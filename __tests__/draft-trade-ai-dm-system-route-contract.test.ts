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
const buildDraftTradeAiReviewMock = vi.fn()
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

vi.mock('@/lib/live-draft-engine/DraftTradeAiReviewService', () => ({
  buildDraftTradeAiReview: buildDraftTradeAiReviewMock,
}))

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
    buildDraftTradeAiReviewMock.mockReturnValueOnce({
      verdict: 'counter',
      summary: 'Deterministic review says this is close, but ask for one more asset.',
      reasons: ['Value edge is small.'],
      counterReasons: ['Ask for a future middle-round pick.'],
      declineReasons: [],
      suggestedCounterPackage: null,
    })
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
    buildDraftTradeAiReviewMock.mockReturnValueOnce({
      verdict: 'counter',
      summary: 'Counter is preferred based on deterministic edge.',
      reasons: ['Expected value is slightly negative.'],
      counterReasons: ['Ask for one extra future pick.'],
      declineReasons: ['Current proposal underprices your pick.'],
      suggestedCounterPackage: null,
    })
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
