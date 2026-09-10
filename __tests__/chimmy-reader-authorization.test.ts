import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

/**
 * ── READER AUTHORIZATION: the league readers that sit OUTSIDE the refusal path ───────────────
 *
 * The two commits already on this branch closed three disclosures, and every one of them lived
 * on the same stretch of code: the block that decides whether to return a 412. The suites that
 * cover them (`chimmy-insight-authorization`, `chimmy-league-indistinguishability`) drive a
 * question that REQUIRES league grounding, because that is the only kind that reaches a refusal.
 *
 * 🛑 THAT IS ALSO WHY THEY COULD NOT HAVE FOUND WHAT IS IN THIS FILE. `requiresLeagueGrounding`
 * is a pattern match over the message — `lib/agents/leagueGroundingGate.ts`. "What is X worth?"
 * carries none of its markers: not trade, not waiver, not "my team", not "should i". So
 * `leagueGroundingRequired` is FALSE, the 412 never fires, and the request runs on through
 * readers that were keyed on `formData.get('leagueId')`. A suite that only ever asks a
 * league-required question cannot observe a single line of that.
 *
 * Three readers are covered here, and they fail in three different ways:
 *
 *   1. `buildFantasyCalcValueAnswer` → `createLeagueOsLoaders().loadRules(leagueId)`.
 *      The worst of them, because the disclosure is the ANSWER rather than an error: a stranger's
 *      league was read for format and size, and the reply came back "dynasty value 6644 …
 *      Settings read from your league: superflex, 10-team". The price alone is an oracle even
 *      with the sentence removed — dynasty and redraft return different numbers.
 *
 *   2. `buildDecisionOsGroundingPacket` — the widest, and the only one behind a FLAG
 *      (`DECISION_OS_GROUNDING_ENABLED`). Tested with the flag both ON and OFF, because a flag
 *      that happens to be off proves nothing about the code under it.
 *
 *   3. `getFullAIContext` → `aILeagueContext.findUnique` + `getTeamSnapshots` +
 *      `getRecentMemoryEvents`, whose output becomes `legacyMemorySection` in the prompt.
 *
 * ⚠ EVERY "NEVER CALLED" TEST HERE HAS AN AUTHORIZED POSITIVE CONTROL BESIDE IT. Without one,
 * all of them would still pass with the feature deleted outright, which is the failure mode this
 * repo has already shipped once.
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

// ── the three protected readers under test ───────────────────────────────────────────────────
const loadRulesMock = vi.fn()
const getFantasyCalcValuesDbFirstMock = vi.fn()
const buildDecisionOsGroundingPacketMock = vi.fn()
const getFullAIContextMock = vi.fn()

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
/*
 * ⚠ `buildMemoryPromptSection` IS MOCKED ALONGSIDE `getFullAIContext` BECAUSE THEY SHARE A MODULE.
 * Mocking the module replaces both, and the route imports both from it — leaving the section
 * builder out produces "not a function" rather than a finding.
 */
vi.mock('@/lib/ai-memory', () => ({
  getFullAIContext: getFullAIContextMock,
  buildMemoryPromptSection: vi.fn().mockReturnValue(''),
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
vi.mock('@/lib/decision-os/league-os', () => ({
  createLeagueOsLoaders: () => ({ loadRules: loadRulesMock }),
}))
vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: getFantasyCalcValuesDbFirstMock,
}))
vi.mock('@/lib/decision-os/grounding/packet', () => ({
  buildDecisionOsGroundingPacket: buildDecisionOsGroundingPacketMock,
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

/**
 * A sentinel woven through every field a reader could echo. If any of these strings reaches a
 * response body for an unauthorized caller, something read the league and published it.
 */
const SENTINEL = {
  name: 'ZZSENTINELLEAGUENAMEZZ',
  platformLeagueId: 'ZZSENTINELPLATFORMIDZZ',
  scoring: 'ZZSENTINELSCORINGZZ',
  timezone: 'America/Chicago',
}

/** A real league owned by someone else — produces `not_member`. */
const OTHERS_LEAGUE = {
  id: 'league-real',
  userId: 'owner-9',
  name: SENTINEL.name,
  sport: 'nfl',
  platform: 'sleeper',
  platformLeagueId: SENTINEL.platformLeagueId,
  season: 2026,
  leagueSize: 10,
  scoring: SENTINEL.scoring,
  leagueVariant: null,
  isDynasty: true,
  status: 'in_season',
  timezone: SENTINEL.timezone,
  lastSyncedAt: new Date('2026-08-25T00:00:00.000Z'),
  importBatchId: null,
  importedAt: null,
}

/** The same row, owned by the caller — the authorized positive control. */
const MY_LEAGUE = { ...OTHERS_LEAGUE, userId: 'stranger-1' }

/**
 * A DYNASTY / SUPERFLEX / 10-team rule set. Chosen so that reading it is VISIBLE in the answer:
 * dynasty changes the price, superflex changes `numQbs`, and 10-team prints as "10-team". If the
 * guard leaks, these show up; if it holds, they cannot.
 */
const LEAGUE_RULES = {
  general: { format: 'dynasty', teamCount: 10 },
  roster: { starters: ['QB', 'RB', 'WR', 'SUPER_FLEX'] },
  scoring: { activeRules: [{ statKey: 'rec', pointsValue: 1 }] },
}

function request(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return createMockNextRequest('http://localhost/api/chat/chimmy', { method: 'POST', body: fd })
}

/*
 * ⚠ 120s, MEASURED, and inherited from the sibling suites for the same reason: importing the
 * 3,100-line route pays a cold Vite transform that lands on whichever test runs first.
 */
vi.setConfig({ testTimeout: 120000 })

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.DECISION_OS_GROUNDING_ENABLED
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
  getFullAIContextMock.mockResolvedValue({
    userProfile: null,
    leagueContext: null,
    teamSnapshots: [],
    recentEvents: [],
    patterns: [],
  })
  buildDecisionOsGroundingPacketMock.mockResolvedValue({
    meta: { durationMs: 5 },
    sections: [],
  })
  loadRulesMock.mockResolvedValue(LEAGUE_RULES)
  getFantasyCalcValuesDbFirstMock.mockResolvedValue([
    { player: { name: 'Jeremiyah Love' }, value: 6644, overallRank: 16, positionRank: 4, trend30Day: -375 },
  ])
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
/** The authorized control: the caller owns the league. */
function asAuthorized() {
  prismaLeagueFindUniqueMock.mockResolvedValue(MY_LEAGUE)
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

/**
 * 🛑 THE QUESTION IS THE WHOLE POINT OF THIS FILE. "worth" carries none of
 * `GROUNDED_MESSAGE_PATTERN`'s markers, so `leagueGroundingRequired` is false and the 412 refusal
 * never fires — which is exactly how these readers were reached with an id nobody had checked.
 */
/*
 * ⚠ THE WORDING IS CONSTRAINED FROM THREE DIRECTIONS AT ONCE, and getting any one wrong makes
 * every assertion below vacuous rather than red:
 *   - it must contain a `SPORTS_KEYWORDS` entry ("nfl"), or `hasSportsContent` deflects it at
 *     ~1361 with "That didn't look like a fantasy sports question" and nothing runs;
 *   - it must contain NONE of `GROUNDED_MESSAGE_PATTERN`, or the 412 fires and the readers are
 *     never reached — no "trade", "should i", "keeper", "my team";
 *   - `extractLikelyPlayerName` must find a name, which its `(?:value|worth|on|for)\s+<Proper>`
 *     branch does via "on Jeremiyah Love".
 * The first draft of this file used "What is Jeremiyah Love worth?" and was deflected by the
 * keyword gate — five tests failed for a reason that had nothing to do with authorization.
 */
const VALUE_MESSAGE = 'What is the NFL value on Jeremiyah Love?'
const VALUE_Q = { message: VALUE_MESSAGE, leagueId: 'league-real' }
/** The same question with no league named at all — the "generic basis" wording control. */
const VALUE_Q_NO_LEAGUE = { message: VALUE_MESSAGE }

/**
 * A question that reaches the FULL pipeline: not deflected by the sports-keyword gate, not
 * league-grounding-required (so no 412), and not answered by any deterministic builder (so no
 * short-circuit). Shared by the two blocks below, both of which are worthless without it.
 */
const NON_GROUNDED_Q = {
  message: 'How does PPR scoring work in the NFL?',
  leagueId: 'league-real',
  confirmTokenSpend: 'true',
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the deterministic value path reads league rules', () => {
  it('🛑 PRECONDITION: an unauthorized value question is NOT refused — it reaches the answer', async () => {
    /*
     * Asserted first and alone. Every "did not leak" assertion below is vacuous if the route
     * simply 412s here, and a 412 is what the existing suites see for every question they ask.
     * This is the assertion that says the readers really are reachable without authorization.
     */
    asInaccessible()
    const res = await post(VALUE_Q)
    expect(res.status).not.toBe(412)
    expect(res.status).toBeLessThan(400)
  })

  it('🛑 does not read the league rules of a league the caller cannot access', async () => {
    asInaccessible()
    await post(VALUE_Q)
    expect(loadRulesMock).not.toHaveBeenCalled()
  })

  it('🛑 does not read the league rules of a league that does not exist', async () => {
    asNonexistent()
    await post(VALUE_Q)
    expect(loadRulesMock).not.toHaveBeenCalled()
  })

  it('✅ CONTROL: an AUTHORIZED caller still gets league-specific valuation', async () => {
    /*
     * Without this the three assertions above pass with the whole value feature deleted, and the
     * fix would have "worked" by breaking the product. This pins BOTH halves: the read happens,
     * and it happens against the authorized id rather than the raw request field.
     */
    asAuthorized()
    await post(VALUE_Q)
    expect(loadRulesMock).toHaveBeenCalledWith('league-real')
    expect(getFantasyCalcValuesDbFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ isDynasty: true, numQbs: 2, numTeams: 10 }),
    )
  })

  it('🛑 an unauthorized caller is priced on the GENERIC basis, not the league basis', async () => {
    /*
     * The price is the oracle even with every sentence removed: dynasty/superflex returns 6644
     * and 1QB redraft does not. So this asserts on the QUERY, which is what the number comes from.
     */
    asInaccessible()
    await post(VALUE_Q)
    expect(getFantasyCalcValuesDbFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ isDynasty: false, numQbs: 1 }),
    )
  })

  it('🛑 no sentinel from the league row reaches the response body', async () => {
    asInaccessible()
    const res = await post(VALUE_Q)
    for (const value of Object.values(SENTINEL)) {
      expect(res.text).not.toContain(value)
    }
    expect(res.text).not.toMatch(/10-team/i)
    expect(res.text).not.toMatch(/superflex/i)
    expect(res.text).not.toMatch(/settings read from your league/i)
  })

  it('🛑 the fallback wording stays TRUE: they DID name a league, so it must not say otherwise', async () => {
    /*
     * ⚠ THE OBVIOUS FIX GETS THIS WRONG. Passing `null` for the id alone makes the answer say
     * "You did not name a league", which is false and is the sort of small lie that erodes every
     * other sentence in the reply. The id is withheld; the FACT that one was requested is not.
     */
    asInaccessible()
    const res = await post(VALUE_Q)
    expect(res.text).toMatch(/could not read that league's settings/i)
    expect(res.text).not.toMatch(/did not name a league/i)
  })

  it('✅ CONTROL: with no league named at all, the wording says exactly that', async () => {
    const res = await post(VALUE_Q_NO_LEAGUE)
    expect(res.text).toMatch(/did not name a league/i)
    expect(loadRulesMock).not.toHaveBeenCalled()
  })

  it('🛑 inaccessible and nonexistent produce the SAME answer text', async () => {
    /*
     * The indistinguishability property, re-asserted at this path rather than assumed from the
     * refusal path — they are different code and the refusal suite never runs through here.
     */
    asInaccessible()
    const a = await post(VALUE_Q)
    asNonexistent()
    const b = await post(VALUE_Q)
    expect(a.status).toBe(b.status)
    /*
     * ⚠ COMPARED ON `response`, NOT ON THE RAW BODY, AND THAT IS NOT A WEAKENING. `sessionId` is
     * `${userId}-${Date.now()}`, so a whole-body comparison can never hold between two sequential
     * requests — it would fail on the clock and be "fixed" by deleting it, which is how a real
     * assertion gets thrown away. The answer text is the channel; the timestamp is not one.
     */
    const answerOf = (r: typeof a) => (r.json as { response?: string } | null)?.response
    expect(answerOf(a)).toBeTruthy()
    expect(answerOf(a)).toBe(answerOf(b))
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the Decision OS grounding packet — the flagged reader', () => {
  /**
   * 🛑 THE QUESTION HERE IS LOAD-BEARING, AND THE FIRST DRAFT OF THIS BLOCK GOT IT WRONG.
   *
   * It asked "Should I accept this trade?", which trips `GROUNDED_MESSAGE_PATTERN` — so an
   * unauthorized caller is refused with a 412 at ~1258, hundreds of lines BEFORE the grounding
   * task is constructed. "The packet was never built" was therefore true of every implementation,
   * including the vulnerable one: restoring the bypass left the suite 15/15 GREEN.
   *
   * The bypass only bites on a question that does NOT require grounding, because that is the one
   * that survives past the refusal. So the question must clear three gates and trip none:
   * `hasSportsContent` yes ("ppr", "nfl"), the grounding classifiers no, and no deterministic
   * builder — otherwise the short-circuit at ~1420 returns first.
   *
   * ⚠ THE SECOND DRAFT USED "How does SUPERFLEX scoring work" AND ALSO FAILED, for a reason worth
   * recording because it is invisible on inspection: `ROSTER_INTENT` at route.ts:601 matches bare
   * `flex` with NO word boundaries, so "super​flex" classifies as a ROSTER question, which forces
   * grounding, which 412s. "PPR" carries the same meaning to a reader and trips nothing.
   *
   * ⚠ AND THAT IS WHY THE PRECONDITION BELOW IS ITS OWN TEST. It is the only thing standing
   * between this block and a second round of assertions that cannot fail.
   */
  it('🛑 PRECONDITION: this question is NOT refused and DOES reach the grounding stage', async () => {
    process.env.DECISION_OS_GROUNDING_ENABLED = 'true'
    asAuthorized()
    const res = await post(NON_GROUNDED_Q)
    expect(res.status).not.toBe(412)
    expect(res.status).toBeLessThan(400)
    // Reaching the stage at all is what the three tests below depend on.
    expect(buildDecisionOsGroundingPacketMock).toHaveBeenCalled()
  })

  it('🛑 flag ON, unauthorized league: the packet is never built', async () => {
    process.env.DECISION_OS_GROUNDING_ENABLED = 'true'
    asInaccessible()
    await post(NON_GROUNDED_Q)
    expect(buildDecisionOsGroundingPacketMock).not.toHaveBeenCalled()
  })

  it('🛑 flag ON, nonexistent league: the packet is never built', async () => {
    process.env.DECISION_OS_GROUNDING_ENABLED = 'true'
    asNonexistent()
    await post(NON_GROUNDED_Q)
    expect(buildDecisionOsGroundingPacketMock).not.toHaveBeenCalled()
  })

  it('✅ CONTROL: flag ON, AUTHORIZED league — the packet IS built, on the authorized id', async () => {
    /*
     * ⚠ THIS IS THE ASSERTION THAT MAKES THE TWO ABOVE MEAN ANYTHING. With the flag respected but
     * the feature never reached, "not called" is true for the wrong reason.
     */
    process.env.DECISION_OS_GROUNDING_ENABLED = 'true'
    asAuthorized()
    await post(NON_GROUNDED_Q)
    expect(buildDecisionOsGroundingPacketMock).toHaveBeenCalledTimes(1)
    expect(buildDecisionOsGroundingPacketMock).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'league-real', userId: 'stranger-1' }),
    )
  })

  it('the flag still governs: OFF and authorized builds nothing', async () => {
    /*
     * The guard was tightened around the flag, not in place of it. If this ever goes red the fix
     * has quietly turned a flagged feature on for everybody.
     */
    process.env.DECISION_OS_GROUNDING_ENABLED = 'false'
    asAuthorized()
    await post(NON_GROUNDED_Q)
    expect(buildDecisionOsGroundingPacketMock).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('the AI memory context reader', () => {
  /*
   * ⚠ THIS BLOCK USES `NON_GROUNDED_Q` FOR THE SAME REASON THE ONE ABOVE DOES, and its first
   * draft made the identical mistake: with "Should I accept this trade?" an unauthorized caller
   * is refused at ~1258 and `getFullAIContext` is never reached, so "the id never got there" was
   * true of the vulnerable code as well.
   */
  it('🛑 PRECONDITION: this question reaches getFullAIContext at all', async () => {
    asAuthorized()
    const res = await post(NON_GROUNDED_Q)
    expect(res.status).toBeLessThan(400)
    expect(getFullAIContextMock).toHaveBeenCalled()
  })

  it('🛑 an unauthorized league id never reaches getFullAIContext', async () => {
    /*
     * `getFullAIContext` makes three league-scoped reads and none of them checks membership; its
     * output becomes `legacyMemorySection` in the prompt. Asserting on the ARGUMENT rather than on
     * "not called" is deliberate — the call still happens for the user's own profile, so "never
     * called" would be the wrong property and would go red for a correct implementation.
     */
    asInaccessible()
    await post(NON_GROUNDED_Q)
    expect(getFullAIContextMock).toHaveBeenCalled()
    for (const call of getFullAIContextMock.mock.calls) {
      expect(call[0]?.leagueId).toBeUndefined()
    }
  })

  it('✅ CONTROL: an AUTHORIZED league id DOES reach getFullAIContext', async () => {
    asAuthorized()
    await post(NON_GROUNDED_Q)
    expect(getFullAIContextMock).toHaveBeenCalledWith(
      expect.objectContaining({ leagueId: 'league-real' }),
    )
  })
})
