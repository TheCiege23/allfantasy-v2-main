import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

/**
 * An inaccessible league and a nonexistent one must be indistinguishable.
 *
 * 🛑 WHY THIS FILE EXISTS, AND IT IS A CORRECTION. A previous pass removed the
 * words "I can see that league exists" from the `not_member` copy and claimed
 * the two cases now read identically. They did not: `not_member` said "could not
 * open that league" and `not_found` said "could not FIND that league". Walk ids,
 * read the verb, learn which leagues are real.
 *
 * 🛑 AND THE TEST THAT WAS SUPPOSED TO COVER IT COULD NOT HAVE. It asserted
 * `expect(body.details?.message).toMatch(/could not open that league/i)` — which
 * PINS the distinguishable string rather than comparing the two cases. An
 * assertion about one branch can never detect that the other branch differs.
 *
 * So every test here drives BOTH cases through the real POST handler and
 * compares them to each other. There is no single-case assertion in this file
 * about the message, because a single-case assertion is what failed.
 *
 * ⚠ `anonymous` AND `error` ARE ALLOWED TO DIFFER, and that is asserted too.
 * Anonymous is an authentication problem the user can fix and reveals nothing
 * about which leagues exist. `error` is transient infrastructure — collapsing it
 * into the refusal would tell a member of their own league that they are not in
 * it, which is a different and worse lie.
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

/** A real league owned by someone else — produces `not_member`. */
const OTHERS_LEAGUE = {
  id: 'league-real',
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

function request(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return createMockNextRequest('http://localhost/api/chat/chimmy', { method: 'POST', body: fd })
}

/*
 * ⚠ 120s, MEASURED. Importing the 3,100-line route pays a cold Vite transform
 * that lands on whichever test runs FIRST; the sibling route-contract file
 * records the same effect. A transform-cost timeout is not a logic hang, and the
 * tell is that the file passes in isolation.
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
  prismaRedraftMemberFindUniqueMock.mockResolvedValue(null)
  prismaRosterCountMock.mockResolvedValue(0)
  prismaLeagueTeamFindFirstMock.mockResolvedValue(null)
  getInsightBundleMock.mockResolvedValue({ sport: 'NFL', insightType: 'trade', contextText: '', sources: [] })
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

/** `not_member`: the row exists, owned by someone else, no membership path hits. */
function asInaccessible() {
  prismaLeagueFindUniqueMock.mockResolvedValue(OTHERS_LEAGUE)
}

/** `not_found`: no row at all. */
function asNonexistent() {
  prismaLeagueFindUniqueMock.mockResolvedValue(null)
}

async function post(fields: Record<string, string>) {
  const { POST } = await import('@/app/api/chat/chimmy/route')
  const res = await POST(request(fields) as never)
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    /* not JSON — the raw text is still compared */
  }
  return { status: res.status, text, json }
}

/** A question that REQUIRES a league, so the route takes the refusal path. */
const LEAGUE_REQUIRED = { message: 'Should I accept this trade?', leagueId: 'league-real' }

/**
 * A question that does NOT require a league, with the token spend confirmed so
 * the handler runs to completion and constructs `meta`.
 *
 * 🛑 `confirmTokenSpend` IS LOAD-BEARING. Without it the route returns 409
 * `token_confirmation_required` before `meta` is built, and every assertion
 * about the answer payload would be true of a payload that could not have
 * contained a league either way. That is how the previous pass's leakage tests
 * passed while the disclosure was live.
 */
const GLOBAL_200 = {
  message: 'Who leads the NFL in rushing?',
  leagueId: 'league-real',
  confirmTokenSpend: 'true',
}

describe('the league-required refusal path', () => {
  it('🛑 reaches the refusal, not a token-confirmation 409 — the precondition', async () => {
    /*
     * Asserted FIRST and separately. If the route stopped at 409 here, every
     * comparison below would be comparing two identical 409s and would pass
     * while the refusal payloads differed.
     */
    asInaccessible()
    const a = await post(LEAGUE_REQUIRED)
    expect(a.status).toBe(412)
    asNonexistent()
    const b = await post(LEAGUE_REQUIRED)
    expect(b.status).toBe(412)
  })

  it('returns the SAME status for inaccessible and nonexistent', async () => {
    asInaccessible()
    const a = await post(LEAGUE_REQUIRED)
    asNonexistent()
    const b = await post(LEAGUE_REQUIRED)
    expect(a.status).toBe(b.status)
  })

  it('🛑 returns a BYTE-IDENTICAL body for inaccessible and nonexistent', async () => {
    /*
     * The whole property, in one assertion. Not "similar", not "neither contains
     * the id" — identical. Anything that differs is a channel, including a key
     * present in one and absent in the other.
     */
    asInaccessible()
    const a = await post(LEAGUE_REQUIRED)
    asNonexistent()
    const b = await post(LEAGUE_REQUIRED)
    expect(a.text).toBe(b.text)
  })

  it('and neither body carries the league id, name or platform id', async () => {
    for (const setup of [asInaccessible, asNonexistent]) {
      setup()
      const r = await post(LEAGUE_REQUIRED)
      for (const secret of ['league-real', 'The Secret Cartel', '999888777', 'ppr superflex']) {
        expect(r.text, secret).not.toContain(secret)
      }
    }
  })

  it('and neither body carries the internal reason code', async () => {
    for (const setup of [asInaccessible, asNonexistent]) {
      setup()
      const r = await post(LEAGUE_REQUIRED)
      expect(r.text).not.toContain('not_member')
      expect(r.text).not.toContain('not_found')
      expect(r.text).not.toContain('groundingReason')
    }
  })

  it('neither refusal bills the user — so spend is not a side channel either', async () => {
    for (const setup of [asInaccessible, asNonexistent]) {
      setup()
      await post(LEAGUE_REQUIRED)
      expect(spendTokensForRuleMock).not.toHaveBeenCalled()
    }
  })
})

describe('the successful global-answer path, at a real HTTP 200', () => {
  it('🛑 actually reaches 200 with the spend confirmed — the precondition', async () => {
    /*
     * Asserted before any comparison. A 409 here would make every assertion
     * below vacuous, which is exactly the failure this file was written after.
     */
    asInaccessible()
    const a = await post(GLOBAL_200)
    expect(a.status).toBe(200)
    asNonexistent()
    const b = await post(GLOBAL_200)
    expect(b.status).toBe(200)
  })

  it('🛑 the constructed meta.leagueGrounding is IDENTICAL in both cases', async () => {
    asInaccessible()
    const a = await post(GLOBAL_200)
    asNonexistent()
    const b = await post(GLOBAL_200)
    const ga = (a.json as Record<string, any>)?.meta?.leagueGrounding
    const gb = (b.json as Record<string, any>)?.meta?.leagueGrounding
    // Present at all — otherwise "identical" is trivially true of two undefineds.
    expect(ga).toBeDefined()
    expect(gb).toBeDefined()
    expect(ga).toEqual(gb)
  })

  it('preserves grounded:false, which the drawer renders', async () => {
    /*
     * ⚠ THE FLAG STAYS. "Chimmy is answering without your league" is a state the
     * user should see; the identifiers beside it were never theirs to read.
     */
    asInaccessible()
    const r = await post(GLOBAL_200)
    expect((r.json as Record<string, any>)?.meta?.leagueGrounding?.grounded).toBe(false)
  })

  it('publishes no league id and no reason code in meta', async () => {
    for (const setup of [asInaccessible, asNonexistent]) {
      setup()
      const r = await post(GLOBAL_200)
      const g = (r.json as Record<string, any>)?.meta?.leagueGrounding
      expect(g?.leagueId ?? null).toBeNull()
      expect(g?.reason).toBeUndefined()
    }
  })

  it('and the whole 200 body carries none of the league identifiers', async () => {
    for (const setup of [asInaccessible, asNonexistent]) {
      setup()
      const r = await post(GLOBAL_200)
      for (const secret of ['league-real', 'The Secret Cartel', '999888777', 'America/Chicago']) {
        expect(r.text, secret).not.toContain(secret)
      }
    }
  })

  it('no downstream league read happens after authorization fails', async () => {
    /*
     * Membership itself issues one `{id, sport, userId}` read — that read IS the
     * check. What must not follow is a second, descriptive read, which is the
     * data that would reach the prompt.
     */
    for (const setup of [asInaccessible, asNonexistent]) {
      setup()
      await post(GLOBAL_200)
      const selects = prismaLeagueFindUniqueMock.mock.calls.map((c: any) =>
        Object.keys(c?.[0]?.select ?? {}).sort().join(',')
      )
      expect(selects).toEqual(selects.map(() => 'id,sport,userId'))
    }
  })

  it('and getInsightBundle is never reached in either case', async () => {
    for (const setup of [asInaccessible, asNonexistent]) {
      setup()
      await post({ ...GLOBAL_200, insightType: 'playoff' })
      expect(getInsightBundleMock).not.toHaveBeenCalled()
    }
  })
})

describe('an AUTHORIZED member is unaffected — the positive control', () => {
  beforeEach(() => {
    prismaLeagueFindUniqueMock.mockResolvedValue({ ...OTHERS_LEAGUE, userId: 'stranger-1' })
  })

  it('🛑 gets a GROUNDED answer naming their own league', async () => {
    /*
     * Without this, every "the body does not contain the league name" assertion
     * above would pass with league grounding deleted entirely.
     */
    const r = await post(GLOBAL_200)
    expect(r.status).toBe(200)
    const g = (r.json as Record<string, any>)?.meta?.leagueGrounding
    expect(g?.grounded).toBe(true)
    expect(g?.leagueId).toBe('league-real')
  })

  it('and a league-required question is answered rather than refused', async () => {
    const r = await post({ ...LEAGUE_REQUIRED, confirmTokenSpend: 'true' })
    expect(r.status).toBe(200)
  })
})

describe('anonymous and transient failures stay distinguishable, deliberately', () => {
  it('an anonymous caller gets 401, not the league refusal', async () => {
    /*
     * ⚠ ALLOWED TO DIFFER. It is an authentication problem the user can fix, and
     * it reveals nothing about which leagues exist.
     */
    getServerSessionMock.mockResolvedValue(null)
    asInaccessible()
    const r = await post(LEAGUE_REQUIRED)
    expect(r.status).toBe(401)
  })

  it('a transient infrastructure failure is 503, not 412', async () => {
    /*
     * ⚠ ALSO ALLOWED, AND COLLAPSING IT WOULD BE WORSE THAN THE ORACLE. Telling
     * a member of their own league "I could not open that league for your
     * account" when the database merely blinked is a different and more damaging
     * lie than declining to say whether a stranger's league exists.
     */
    prismaLeagueFindUniqueMock.mockImplementation(async (args: any) => {
      const keys = Object.keys(args?.select ?? {}).sort().join(',')
      if (keys === 'id,sport,userId') throw new Error('db down')
      return null
    })
    const r = await post(LEAGUE_REQUIRED)
    expect(r.status).toBe(503)
  })

  it('and the transient message never leaks the underlying error text', async () => {
    prismaLeagueFindUniqueMock.mockImplementation(async () => {
      throw new Error('connect postgres://user:hunter2@db/x')
    })
    const r = await post(LEAGUE_REQUIRED)
    expect(r.text).not.toContain('hunter2')
    expect(r.text).not.toContain('postgres://')
  })
})
