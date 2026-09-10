import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

/**
 * Request-boundary proof that a league insight bundle is never built from an
 * unverified league id.
 *
 * 🛑 WHAT THIS WAS. `app/api/chat/chimmy/route.ts` guarded the insight call on
 * `leagueId && insightType`, and `leagueId` is `formData.get('leagueId')` — a
 * value the client sends. `getInsightBundle` declares no `userId` parameter and
 * `lib/ai-simulation-integration/AIInsightRouter.ts` contains zero occurrences
 * of one, so it read matchup predictions, playoff odds, warehouse summaries and
 * a league settings summary for whatever id it was handed, and the result was
 * placed in the prompt.
 *
 * `requiresLeagueGrounding` forces grounding for `insightType` of trade, waiver
 * or dynasty. `InsightType` has SIX values, so `matchup`, `playoff` and `draft`
 * fell straight through.
 *
 * ⚠ THESE DRIVE THE REAL POST HANDLER, NOT THE SOURCE TEXT. Membership resolves
 * through the real `resolveLeagueMembership` against a mocked prisma, so
 * "authorization failed" is a state the fixture actually reaches rather than one
 * a mock asserts. That is what lets the call-count and leakage assertions mean
 * something.
 */

const getServerSessionMock = vi.fn()
const runAiProtectionMock = vi.fn()
const enrichChatWithDataMock = vi.fn()
const runUnifiedOrchestrationMock = vi.fn()
const requestContractToUnifiedMock = vi.fn()
const unifiedResponseToContractMock = vi.fn()
const validateToolRequestMock = vi.fn()
const buildChimmyConversationIdMock = vi.fn()
const buildAgentPromptMock = vi.fn()
const inferAgentFromMessageMock = vi.fn()
const getChimmyMemoryContextMock = vi.fn()
const resolveNormalizedLeagueContextMock = vi.fn()
const resolveChimmyPersonalizationProfileMock = vi.fn()
const resolveChimmyLeagueSelectionMock = vi.fn()
const detectManagerAmbiguityMock = vi.fn()
const buildChimmyStalenessWarningMock = vi.fn()
const buildChimmySourceReferencesMock = vi.fn()
const buildChimmySportDataDigestMock = vi.fn()
const prismaUserProfileFindUniqueMock = vi.fn()
const prismaUserProfileUpsertMock = vi.fn()
const prismaAppUserFindUniqueMock = vi.fn()
const prismaAiCustomRuleFindManyMock = vi.fn()
const prismaLeagueFindUniqueMock = vi.fn()
const prismaRedraftMemberFindUniqueMock = vi.fn()
const prismaRosterCountMock = vi.fn()
const prismaLeagueTeamFindFirstMock = vi.fn()
const previewSpendMock = vi.fn()
const spendTokensForRuleMock = vi.fn()
const refundSpendByLedgerMock = vi.fn()

/** The single observation point for the defect. */
const getInsightBundleMock = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/ai-protection', () => ({ runAiProtection: runAiProtectionMock }))
vi.mock('@/lib/chat-data-enrichment', () => ({ enrichChatWithData: enrichChatWithDataMock }))
vi.mock('@/lib/ai-orchestration/orchestration-service', () => ({
  runUnifiedOrchestration: runUnifiedOrchestrationMock,
}))
vi.mock('@/lib/ai-tool-registry', () => ({
  requestContractToUnified: requestContractToUnifiedMock,
  unifiedResponseToContract: unifiedResponseToContractMock,
  validateToolRequest: validateToolRequestMock,
}))
vi.mock('@/lib/ai-simulation-integration', () => ({ getInsightBundle: getInsightBundleMock }))
vi.mock('@/lib/league-context-engine', () => ({
  resolveNormalizedLeagueContext: resolveNormalizedLeagueContextMock,
}))
vi.mock('@/lib/ai-memory/chimmy-memory-context', () => ({
  getChimmyMemoryContext: getChimmyMemoryContextMock,
}))
vi.mock('@/lib/ai-memory/chat-history-store', () => ({
  appendChatHistory: vi.fn(),
  buildChimmyConversationId: buildChimmyConversationIdMock,
}))
vi.mock('@/lib/ai-memory/ai-memory-store', () => ({
  rememberChimmyAssistantMemory: vi.fn(),
  rememberChimmyUserMessageMemory: vi.fn(),
  getAiMemory: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/agents/pipeline', () => ({
  buildAgentPrompt: buildAgentPromptMock,
  inferAgentFromMessage: inferAgentFromMessageMock,
}))
vi.mock('@/lib/tokens/TokenSpendService', () => ({
  TokenInsufficientBalanceError: class TokenInsufficientBalanceError extends Error {},
  TokenSpendConfirmationRequiredError: class TokenSpendConfirmationRequiredError extends Error {},
  TokenSpendRuleNotFoundError: class TokenSpendRuleNotFoundError extends Error {},
  TokenSpendService: class {
    previewSpend = previewSpendMock
    spendTokensForRule = spendTokensForRuleMock
    refundSpendByLedger = refundSpendByLedgerMock
  },
}))
vi.mock('@/lib/chimmy-personalization/service', () => ({
  resolveChimmyPersonalizationProfile: resolveChimmyPersonalizationProfileMock,
}))
vi.mock('@/lib/chimmy/chimmy-league-resolution', () => ({
  resolveChimmyLeagueSelection: resolveChimmyLeagueSelectionMock,
  detectManagerAmbiguity: detectManagerAmbiguityMock,
  buildChimmyStalenessWarning: buildChimmyStalenessWarningMock,
  buildChimmySourceReferences: buildChimmySourceReferencesMock,
}))
vi.mock('@/lib/chimmy/chimmy-sport-data-digest', () => ({
  buildChimmySportDataDigest: buildChimmySportDataDigestMock,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    appUser: { findUnique: prismaAppUserFindUniqueMock },
    userProfile: {
      findUnique: prismaUserProfileFindUniqueMock,
      upsert: prismaUserProfileUpsertMock,
    },
    aICustomRule: { findMany: prismaAiCustomRuleFindManyMock },
    league: { findUnique: prismaLeagueFindUniqueMock },
    redraftLeagueMember: { findUnique: prismaRedraftMemberFindUniqueMock },
    roster: { count: prismaRosterCountMock },
    leagueTeam: { findFirst: prismaLeagueTeamFindFirstMock },
  },
}))

/** Everything a leaked league row would contain, so a leak is detectable. */
const PRIVATE_LEAGUE = {
  id: 'league-private',
  userId: 'owner-9',
  name: 'The Secret Cartel',
  sport: 'nfl',
  platform: 'sleeper',
  platformLeagueId: '999888777',
  season: 2026,
  leagueSize: 12,
  scoring: 'ppr superflex',
  leagueVariant: null,
  isDynasty: true,
  status: 'in_season',
  timezone: 'America/Chicago',
  lastSyncedAt: new Date('2026-08-25T00:00:00.000Z'),
  importBatchId: null,
  importedAt: null,
}

/** What `getInsightBundle` would return if it were ever reached for that league. */
const SECRET_INSIGHT = {
  sport: 'NFL',
  insightType: 'playoff',
  contextText:
    'Playoff odds: Secret Cartel 91.4%. Warehouse: cartel-warehouse-summary. League settings: 12-team superflex.',
  sources: ['simulation', 'warehouse', 'league_settings'],
  modelResponsibilities: {},
}

/** Strings that must never appear in a response to an unauthorized caller. */
const LEAKABLE = [
  'league-private',
  'The Secret Cartel',
  '999888777',
  'ppr superflex',
  'America/Chicago',
  '91.4%',
  'cartel-warehouse-summary',
  '12-team superflex',
]

const ALL_INSIGHT_TYPES = ['trade', 'waiver', 'dynasty', 'matchup', 'playoff', 'draft'] as const

function request(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return createMockNextRequest('http://localhost/api/chat/chimmy', { method: 'POST', body: fd })
}

/*
 * ⚠ 120s, AND THE NUMBER IS MEASURED RATHER THAN CHOSEN. Importing the
 * 3,100-line route pays a cold Vite transform that lands entirely on whichever
 * test runs FIRST — `chat-chimmy-route-contract` records the same effect and
 * sets 60s for it. On a box already running other suites this file's first test
 * was measured at 63,745ms and timed out at 60s while the other 48 passed in
 * 3-27ms each.
 *
 * That is a transform-cost timeout, not a logic hang, and the way to tell them
 * apart is that the file passes 49/49 in isolation, repeatedly. File-level
 * rather than on the one slow test, because which test pays the cost is an
 * ordering detail no annotation should depend on.
 */
vi.setConfig({ testTimeout: 120000 })

beforeEach(() => {
  vi.clearAllMocks()
  getServerSessionMock.mockResolvedValue({ user: { id: 'stranger-1' } })
  runAiProtectionMock.mockResolvedValue(null)
  enrichChatWithDataMock.mockResolvedValue({ context: '', audit: { sourcesUsed: [] } })
  validateToolRequestMock.mockReturnValue({ valid: true })
  buildChimmyConversationIdMock.mockReturnValue('conversation-1')
  buildAgentPromptMock.mockImplementation(async ({ userMessage }: { userMessage: string }) => userMessage)
  inferAgentFromMessageMock.mockReturnValue('trade_analyzer')
  getChimmyMemoryContextMock.mockResolvedValue({ promptSection: '' })
  resolveNormalizedLeagueContextMock.mockResolvedValue({ ok: true, context: {} })
  resolveChimmyPersonalizationProfileMock.mockResolvedValue(null)
  resolveChimmyLeagueSelectionMock.mockResolvedValue({
    kind: 'ask',
    message: 'Which league?',
    choices: [],
    leagues: [],
  })
  detectManagerAmbiguityMock.mockReturnValue({ kind: 'ok' })
  buildChimmyStalenessWarningMock.mockReturnValue({ warning: null, staleMinutes: 1, thresholdMinutes: 10 })
  buildChimmySourceReferencesMock.mockReturnValue([])
  buildChimmySportDataDigestMock.mockResolvedValue({ text: '', sources: [] })
  prismaAppUserFindUniqueMock.mockResolvedValue({ emailVerified: new Date('2025-01-01') })
  prismaUserProfileUpsertMock.mockResolvedValue({
    userId: 'stranger-1',
    displayName: null,
    phone: null,
    phoneVerifiedAt: null,
    emailVerifiedAt: null,
    ageConfirmedAt: new Date('2025-01-01'),
    profileComplete: true,
  })
  prismaUserProfileFindUniqueMock.mockResolvedValue(null)
  prismaAiCustomRuleFindManyMock.mockResolvedValue([])

  // The league exists and is owned by SOMEONE ELSE. Every membership path misses.
  prismaLeagueFindUniqueMock.mockResolvedValue(PRIVATE_LEAGUE)
  prismaRedraftMemberFindUniqueMock.mockResolvedValue(null)
  prismaRosterCountMock.mockResolvedValue(0)
  prismaLeagueTeamFindFirstMock.mockResolvedValue(null)

  getInsightBundleMock.mockResolvedValue(SECRET_INSIGHT)

  previewSpendMock.mockResolvedValue({
    ruleCode: 'ai_chimmy_chat_message',
    tokenCost: 15,
    canSpend: true,
    currentBalance: 20,
  })
  spendTokensForRuleMock.mockResolvedValue({ id: 'ledger-1', balanceAfter: 5 })
  refundSpendByLedgerMock.mockResolvedValue(null)
  requestContractToUnifiedMock.mockReturnValue({ envelope: {} })
  unifiedResponseToContractMock.mockReturnValue({
    aiExplanation: 'Here is the answer.',
    actionPlan: null,
    confidence: 70,
    uncertainty: null,
    providerResults: [],
    reliability: null,
    debugTrace: { providerUsed: 'openai' },
  })
  runUnifiedOrchestrationMock.mockResolvedValue({
    ok: true,
    response: {
      modelOutputs: [
        { model: 'openai', modelName: 'gpt-4o-mini', raw: 'Here is the answer.', skipped: false, tokensPrompt: 10, tokensCompletion: 5 },
      ],
    },
  })
})

async function post(fields: Record<string, string>) {
  const { POST } = await import('@/app/api/chat/chimmy/route')
  const res = await POST(request(fields) as never)
  const body = await res.text()
  return { res, body }
}

describe('an AUTHORIZED member still gets insights — the positive control', () => {
  beforeEach(() => {
    // `stranger-1` now owns it, so membership resolves on the first check.
    prismaLeagueFindUniqueMock.mockResolvedValue({ ...PRIVATE_LEAGUE, userId: 'stranger-1' })
  })

  it.each(ALL_INSIGHT_TYPES)('calls getInsightBundle for insightType=%s', async (insightType) => {
    /*
     * 🛑 WITHOUT THIS, EVERY "NEVER CALLED" ASSERTION BELOW IS VACUOUS. If the
     * insight path were simply dead, all six unauthorized cases would pass with
     * the feature deleted.
     */
    await post({ message: 'How does my team look?', leagueId: 'league-private', insightType })
    expect(getInsightBundleMock).toHaveBeenCalled()
  })

  it('and passes the CANONICAL id from the authorized loader', async () => {
    await post({ message: 'How does my team look?', leagueId: 'league-private', insightType: 'playoff' })
    expect(getInsightBundleMock.mock.calls[0][0]).toBe(PRIVATE_LEAGUE.id)
  })
})

describe('a DIFFERENT, unauthorized user — every insight type', () => {
  it.each(ALL_INSIGHT_TYPES)('insightType=%s never reaches getInsightBundle', async (insightType) => {
    await post({ message: 'How does that team look?', leagueId: 'league-private', insightType })
    expect(getInsightBundleMock).not.toHaveBeenCalled()
  })

  it.each(ALL_INSIGHT_TYPES)('insightType=%s leaks nothing into the response', async (insightType) => {
    const { body } = await post({
      message: 'How does that team look?',
      leagueId: 'league-private',
      insightType,
    })
    for (const secret of LEAKABLE) {
      expect(body, `leaked "${secret}" for ${insightType}`).not.toContain(secret)
    }
  })

  it('no league Prisma read happens AFTER authorization fails', async () => {
    /*
     * Membership itself reads `league.findUnique` once — that read is what
     * performs the check. What must not happen is a SECOND read for the
     * descriptive snapshot, which is the data that would reach the prompt.
     */
    await post({ message: 'How does that team look?', leagueId: 'league-private', insightType: 'playoff' })
    const selects = prismaLeagueFindUniqueMock.mock.calls.map((c: any) => Object.keys(c?.[0]?.select ?? {}).sort())
    expect(selects).toEqual([['id', 'sport', 'userId']])
  })

  it('the response carries no groundingReason or internal error detail', async () => {
    const { body } = await post({
      message: 'How does that team look?',
      leagueId: 'league-private',
      insightType: 'playoff',
    })
    expect(body).not.toContain('not_member')
    expect(body).not.toContain('groundingReason')
  })
})

describe('an ANONYMOUS caller', () => {
  it.each(ALL_INSIGHT_TYPES)('insightType=%s is rejected before any insight', async (insightType) => {
    getServerSessionMock.mockResolvedValue(null)
    const { res } = await post({ message: 'How does that look?', leagueId: 'league-private', insightType })
    expect(res.status).toBe(401)
    expect(getInsightBundleMock).not.toHaveBeenCalled()
  })
})

describe('a NONEXISTENT league', () => {
  beforeEach(() => prismaLeagueFindUniqueMock.mockResolvedValue(null))

  it.each(ALL_INSIGHT_TYPES)('insightType=%s never reaches getInsightBundle', async (insightType) => {
    await post({ message: 'How does that look?', leagueId: 'no-such-league', insightType })
    expect(getInsightBundleMock).not.toHaveBeenCalled()
  })
})

describe('a membership lookup FAILURE fails closed', () => {
  beforeEach(() =>
    /*
     * ⚠ REJECTS ONLY THE MEMBERSHIP-SHAPED READ, and both halves of that are
     * deliberate.
     *
     * A fresh rejection per call rather than `mockRejectedValue`: that helper
     * stores ONE rejected promise and hands the same instance to every caller,
     * so a single unawaited call reports an unhandled rejection against the
     * mock's own line and fails tests that were otherwise passing.
     *
     * And scoped to the `{id, sport, userId}` select — the one
     * `resolveLeagueMembership` issues — because rejecting EVERY league read
     * also rejects one made by a caller that does not handle it, and that
     * unrelated floating promise is then reported as this test's failure.
     * "The membership lookup failed" is the state under test; a database that
     * fails for everything at once is a different scenario.
     */
    prismaLeagueFindUniqueMock.mockImplementation(async (args: any) => {
      const keys = Object.keys(args?.select ?? {}).sort().join(',')
      if (keys === 'id,sport,userId') throw new Error('db down')
      return null
    })
  )

  it.each(ALL_INSIGHT_TYPES)('insightType=%s never reaches getInsightBundle', async (insightType) => {
    /*
     * ⚠ A THROWN AUTHORIZATION CHECK MUST NOT READ AS "NO OBJECTION RAISED" —
     * the shape this repo has been bitten by, where a non-zero status was
     * treated as a verdict.
     */
    await post({ message: 'How does that look?', leagueId: 'league-private', insightType })
    expect(getInsightBundleMock).not.toHaveBeenCalled()
  })

  it('and the error text never reaches the response', async () => {
    const { body } = await post({ message: 'How does that look?', leagueId: 'league-private', insightType: 'playoff' })
    expect(body).not.toContain('db down')
  })
})

describe('authorization passes and the row then disappears (the race)', () => {
  beforeEach(() => {
    /*
     * Membership proved it exists and the user owns it; by the time the snapshot
     * read runs, the row is gone. The snapshot loader returns `not_found`, so
     * `leagueSnapshot` is null and the insight must not be built.
     */
    prismaLeagueFindUniqueMock
      .mockResolvedValueOnce({ ...PRIVATE_LEAGUE, userId: 'stranger-1' })
      .mockResolvedValue(null)
  })

  it.each(ALL_INSIGHT_TYPES)('insightType=%s never reaches getInsightBundle', async (insightType) => {
    await post({ message: 'How does my team look?', leagueId: 'league-private', insightType })
    expect(getInsightBundleMock).not.toHaveBeenCalled()
  })
})

describe('ordinary global sports questions still work', () => {
  it('answers without a league and without any insight call', async () => {
    const { res } = await post({ message: 'Who won the 1992 World Series?' })
    expect(res.status).toBe(200)
    expect(getInsightBundleMock).not.toHaveBeenCalled()
  })

  it('does not read a league at all when none was named', async () => {
    await post({ message: 'Who won the 1992 World Series?' })
    expect(prismaLeagueFindUniqueMock).not.toHaveBeenCalled()
  })

  it('an unauthorized league id does not break an otherwise global question', async () => {
    const { res } = await post({ message: 'Who leads the NFL in rushing?', leagueId: 'league-private' })
    expect(res.status).toBeLessThan(500)
    expect(getInsightBundleMock).not.toHaveBeenCalled()
  })
})
