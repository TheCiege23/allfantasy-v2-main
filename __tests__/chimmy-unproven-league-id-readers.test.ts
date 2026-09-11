import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

/**
 * Request-boundary proof that the two readers reached AFTER the insight bundle
 * never receive a league id the caller merely asserted.
 *
 * 🛑 WHY THIS FILE EXISTS AT ALL. Two fixes landed on 2026-09-11 closing league
 * reads keyed on `formData.get('leagueId')`, and a peer established by mutation
 * that reinstating EITHER turned no test red — 17/17 green with the
 * vulnerability restored. Both were correct by code reading and neither was
 * defended. The existing suites reach `describedTradeEvaluator` directly but
 * never THROUGH the route, which is precisely how the caller-side defect
 * survived them: the evaluator was never the bug.
 *
 * WHAT THE TWO READERS DO WITH AN UNPROVEN ID.
 *   `tryDeterministicAnswerDetailed` -> `buildFantasyCalcValueAnswer` -> `loadRules`,
 *     a cache loader with no membership check of its own, so it reads whatever
 *     id it is handed and prices the answer off that league's settings.
 *   `buildDescribedTradeContext` -> `describedTradeEvaluator.ts:249`, a
 *     `prisma.league.findUnique` selecting scoring, leagueVariant, starters,
 *     settings, rosterSize, irSlots, taxiSlots and a team count.
 *
 * ⚠ THE SECOND ARGUMENT IS THE SUBTLE HALF AND IS ASSERTED SEPARATELY.
 * Withholding the id alone would make the fallback sentence say "You did not
 * name a league" to someone who named one they may not read — false, and a
 * different answer for `not_member` than for `not_found`, which rebuilds the
 * enumeration oracle through the wording instead of through the id.
 * `leagueRequested` is deliberately a boolean: it says a league WAS asked about
 * without saying which. A test that only checked the id would pass with that
 * boolean deleted.
 *
 * ⚠ THESE DRIVE THE REAL POST HANDLER. Membership resolves through the real
 * `resolveLeagueMembership` against a mocked prisma, so "authorization failed"
 * is a state the fixture actually reaches rather than one a mock asserts.
 * `runPECR` is deliberately NOT mocked — the described-trade call lives inside
 * its execute callback, and mocking it would make every assertion here vacuous
 * by never running the code under test.
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
const getInsightBundleMock = vi.fn()
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

/** The two observation points for this file. */
const tryDeterministicAnswerDetailedMock = vi.fn()
const buildDescribedTradeContextMock = vi.fn()

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

/*
 * ⚠ DETERMINISTIC_SOURCE IS RE-EXPORTED DELIBERATELY. The route imports it
 * alongside the function, and a factory that omits it fails the whole suite with
 * "No DETERMINISTIC_SOURCE export is defined on the mock" — the LOUD form of a
 * stale double. The silent form is worse and is what this file exists to prevent
 * elsewhere, so the mock surface is kept honest to the real module here.
 */
vi.mock('@/lib/ai/deterministic', () => ({
  tryDeterministicAnswerDetailed: tryDeterministicAnswerDetailedMock,
  DETERMINISTIC_SOURCE: 'deterministic' as const,
}))
vi.mock('@/lib/chimmy-trade/describedTradeEvaluator', () => ({
  buildDescribedTradeContext: buildDescribedTradeContextMock,
}))

vi.mock('@/lib/league-context-engine', () => ({
  resolveNormalizedLeagueContext: resolveNormalizedLeagueContextMock,
}))
vi.mock('@/lib/ai-memory/chimmy-memory-context', () => ({
  getChimmyMemoryContext: getChimmyMemoryContextMock,
}))
vi.mock('@/lib/agents/pipeline', () => ({
  buildAgentPrompt: buildAgentPromptMock,
  inferAgentFromMessage: inferAgentFromMessageMock,
}))
/*
 * ⚠ THE CLASS, NOT LOOSE FUNCTIONS. `AIAccessResolver` constructs
 * `new TokenSpendService()` at field-initialiser time, so a factory exporting
 * only the three functions fails the whole file with "No TokenSpendService
 * export is defined on the mock" — which is what the first run of this file did.
 * The error classes come too: the route catches them BY IDENTITY, so omitting
 * them turns a caught token error into an unhandled throw.
 */
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
vi.mock('@/lib/ai-memory/chat-history-store', () => ({
  buildChimmyConversationId: buildChimmyConversationIdMock,
}))
vi.mock('@/lib/ai-memory/ai-memory-store', () => ({
  rememberChimmyAssistantMemory: vi.fn(),
  rememberChimmyUserMessageMemory: vi.fn(),
  getAiMemory: vi.fn().mockResolvedValue(null),
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

/** Owned by someone else. Every membership path misses for `stranger-1`. */
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

/**
 * 🛑 A VALUE QUESTION, AND THE WORDING IS LOAD-BEARING IN TWO DIRECTIONS.
 *
 * It must NOT say "trade". `requiresLeagueGrounding` returns true for
 * `/\b(draft order|draft time|waiver|trade)\b/`, and `classifyPecrIntent` maps
 * `trade|swap|offer|deal|give|receiv` to intent `trade`, which forces it too. A
 * grounding-required message with an unauthorized league returns 412 at line
 * ~1261 — BEFORE either reader — so a trade-worded fixture cannot reach the
 * defect at all. Two earlier versions of this file failed exactly that way, with
 * both mocks uncalled.
 *
 * It must ALSO clear `hasSportsContent` at line ~1363, which deflects off-topic
 * messages with a friendly 200 rather than an error. "Is Ja'Marr Chase for
 * Jahmyr Gibbs fair?" was deflected as not a fantasy question.
 *
 * ⚠ A 200 THAT NEVER REACHED THE CODE UNDER TEST IS THE MOST DECEPTIVE SHAPE
 * AVAILABLE HERE, and only the vacuity control at the top of this file
 * distinguished it from a passing suite. Both failures looked like clean runs.
 *
 * "worth" is what `buildFantasyCalcValueAnswer` keys on
 * (`/\b(trade value|fantasycalc|value|worth)\b/i`), which is the reader whose
 * `loadRules` call performs no membership check — so this is the question that
 * actually walked into the defect, not a stand-in for it. The route's own
 * comment puts it plainly: the price itself was the oracle, and the settings
 * sentence merely narrated it.
 */
const VALUE_MESSAGE = 'What is Ja’Marr Chase worth in fantasy football?'

function request(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  return createMockNextRequest('http://localhost/api/chat/chimmy', { method: 'POST', body: fd })
}

/*
 * ⚠ 120s, for the reason `chimmy-insight-authorization` records: importing the
 * 3,100-line route pays a cold Vite transform that lands entirely on whichever
 * test runs FIRST. File-level rather than per-test, because which test pays it
 * is an ordering detail no annotation should depend on.
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

  prismaLeagueFindUniqueMock.mockResolvedValue(PRIVATE_LEAGUE)
  prismaRedraftMemberFindUniqueMock.mockResolvedValue(null)
  prismaRosterCountMock.mockResolvedValue(0)
  prismaLeagueTeamFindFirstMock.mockResolvedValue(null)

  getInsightBundleMock.mockResolvedValue(null)

  /*
   * 🛑 BOTH RETURN null ON PURPOSE. `tryDeterministicAnswerDetailed` short-circuits
   * the whole request when it returns an answer, and `buildDescribedTradeContext`
   * returning a string would change the prompt. Returning null keeps the request
   * flowing so the LATER reader is reached too — otherwise the first assertion in
   * each pair would be the only one that ever ran.
   */
  tryDeterministicAnswerDetailedMock.mockResolvedValue(null)
  buildDescribedTradeContextMock.mockResolvedValue(null)

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
        {
          model: 'openai',
          modelName: 'gpt-4o-mini',
          raw: 'Here is the answer.',
          skipped: false,
          tokensPrompt: 10,
          tokensCompletion: 5,
        },
      ],
    },
  })
})

async function post(fields: Record<string, string>) {
  const { POST } = await import('@/app/api/chat/chimmy/route')
  const res = await POST(request(fields) as never)
  const body = await res.text()
  if (process.env.AF_DEBUG_POST === '1') {
    // eslint-disable-next-line no-console
    console.log('[AF_DEBUG_POST]', res.status, body.slice(0, 400))
  }
  return { res, body }
}

/** Third positional argument of `tryDeterministicAnswerDetailed`. */
function deterministicLeagueArg() {
  return tryDeterministicAnswerDetailedMock.mock.calls[0]?.[2]
}

/** Fourth positional argument — `leagueRequested`. */
function deterministicRequestedArg() {
  return tryDeterministicAnswerDetailedMock.mock.calls[0]?.[3]
}

function describedTradeLeagueArg() {
  return buildDescribedTradeContextMock.mock.calls[0]?.[0]?.leagueId
}

describe('🛑 the readers are actually reached — without this every assertion below is vacuous', () => {
  beforeEach(() => {
    // `stranger-1` owns it, so membership resolves and an id is available to pass.
    prismaLeagueFindUniqueMock.mockResolvedValue({ ...PRIVATE_LEAGUE, userId: 'stranger-1' })
  })

  it('the deterministic reader runs, and receives the AUTHORIZED id', async () => {
    await post({ message: VALUE_MESSAGE, leagueId: 'league-private' })
    expect(tryDeterministicAnswerDetailedMock).toHaveBeenCalled()
    expect(deterministicLeagueArg()).toBe(PRIVATE_LEAGUE.id)
  })

  /*
   * 🛑 THE DESCRIBED-TRADE READER IS NOT COVERED HERE, AND THIS IS NOT AN
   * OVERSIGHT — IT IS A MEASURED LIMIT, RECORDED SO THE NEXT ATTEMPT STARTS
   * FURTHER ALONG.
   *
   * `buildDescribedTradeContext` is called at route.ts:~2830, which sits inside
   * the `plan` callback of `runPECR` (the callback spans 2389-2938). This
   * fixture never enters it. Measured, not guessed: asserting on
   * `enrichChatWithDataMock`, which is called at line 2415 near the TOP of the
   * same callback, returns **0 calls** — so the request returns somewhere
   * between the deterministic reader at 1440 and the `runPECR` invocation at
   * 2378, and `plan` never runs at all.
   *
   * ⚠ SO A "never handed the unproven id" ASSERTION ON THAT READER WOULD HAVE
   * PASSED FOR THE WRONG REASON — the mock is not called under ANY fixture
   * here, authorized or not, which is exactly the vacuous guard this file was
   * written to avoid. Four such tests were written, went red on the positive
   * control, and were removed rather than quietly deleted from the negative
   * side to make the suite green.
   *
   * To finish it, find what returns before 2378 under this mock set — the token
   * spend path at 2280-2313 and the `chimmyToolLoop` at 2331 are the candidates
   * — and drive the request past it. The positive control below is the thing to
   * write first; until `buildDescribedTradeContext` is observed being called
   * with an AUTHORIZED id, no assertion about the unauthorized case means
   * anything.
   */
  it.todo('the described-trade reader runs, and receives the AUTHORIZED id')
})

describe('a league the caller is NOT a member of', () => {
  it('the deterministic reader is never handed the unproven id', async () => {
    await post({ message: VALUE_MESSAGE, leagueId: 'league-private' })
    expect(tryDeterministicAnswerDetailedMock).toHaveBeenCalled()
    expect(deterministicLeagueArg()).toBeNull()
    expect(deterministicLeagueArg()).not.toBe('league-private')
  })

  it('but is still told a league WAS named — the oracle closes on the id, not the wording', async () => {
    await post({ message: VALUE_MESSAGE, leagueId: 'league-private' })
    expect(deterministicRequestedArg()).toBe(true)
  })

  /** Blocked on the same unreached callback — see the note on the control above. */
  it.todo('the described-trade reader is never handed the unproven id')
})

describe('a league that does not exist reads identically to one that is not yours', () => {
  beforeEach(() => {
    prismaLeagueFindUniqueMock.mockResolvedValue(null)
  })

  it('deterministic reader: same null id, same "a league was named" flag', async () => {
    await post({ message: VALUE_MESSAGE, leagueId: 'league-does-not-exist' })
    expect(deterministicLeagueArg()).toBeNull()
    expect(deterministicRequestedArg()).toBe(true)
  })

  it.todo('described-trade reader: same null id')
})

describe('a caller who named no league at all', () => {
  it('is distinguishable INTERNALLY from an unauthorized one, and only there', async () => {
    await post({ message: VALUE_MESSAGE })
    expect(deterministicLeagueArg()).toBeNull()
    /*
     * ⚠ THIS IS THE ASSERTION THAT PINS THE BOOLEAN'S PURPOSE. Naming no league
     * gives `false`; naming one you may not read gives `true`, with the same null
     * id in both. Delete `leagueRequested` and the two cases collapse — which is
     * exactly the fallback sentence telling an unauthorized caller they "did not
     * name a league".
     */
    expect(deterministicRequestedArg()).toBe(false)
  })

  it.todo('and the described-trade reader still runs — it never required a league')
})
