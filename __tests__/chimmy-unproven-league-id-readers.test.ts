import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
const appendChatHistoryMock = vi.fn()
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

/** The observation points for this file. */
const tryDeterministicAnswerDetailedMock = vi.fn()
const buildDescribedTradeContextMock = vi.fn()
/*
 * 🛑 THE THIRD READER, ADDED 2026-09-16. The tool loop is ON by default and was never mocked
 * here, so every request below ran the REAL loop — handed `context.leagueId` straight from the
 * form field. Two of its tools (`get_league_standings`, `get_head_to_head`) read a league with
 * no membership check of their own. Mocked to resolve `null` so the request carries on past it,
 * exactly as it does when the loop has nothing to say.
 */
const runChimmyToolLoopMock = vi.fn()
vi.mock('@/lib/chimmy/tools/chimmyToolLoop', () => ({ runChimmyToolLoop: runChimmyToolLoopMock }))

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
  /* The route gates its cross-league injury scan on this; false keeps these tests on their own path. */
  isOwnRosterInjuryQuestion: () => false,
  tryDeterministicAnswerDetailed: tryDeterministicAnswerDetailedMock,
  DETERMINISTIC_SOURCE: 'deterministic' as const,
}))
/*
 * ⚠ THE REAL MODULE WITH ONE READER REPLACED, NOT A ONE-EXPORT FACTORY. The trade-scenario path
 * (`lib/chimmy/tradeScenarioGrounding.ts`) imports this module's `splitSides` and
 * `extractPlayerNameCandidates`; a factory without them made the scenario's shape check throw,
 * which skipped the reader this file watches — a stale double, caught here on 2026-09-16.
 */
vi.mock('@/lib/chimmy-trade/describedTradeEvaluator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chimmy-trade/describedTradeEvaluator')>()),
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
  appendChatHistory: appendChatHistoryMock,
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

const toolLoopEnvBefore = process.env.CHIMMY_TOOL_LOOP_ENABLED
afterEach(() => {
  if (toolLoopEnvBefore === undefined) delete process.env.CHIMMY_TOOL_LOOP_ENABLED
  else process.env.CHIMMY_TOOL_LOOP_ENABLED = toolLoopEnvBefore
})

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
  runChimmyToolLoopMock.mockResolvedValue(null)
  /* Pinned rather than inherited: these tests are about the loop, so the loop must run. */
  process.env.CHIMMY_TOOL_LOOP_ENABLED = 'true'

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

/** `context.leagueId` as the tool loop received it — what every tool executor reads. */
function toolLoopLeagueArg() {
  return runChimmyToolLoopMock.mock.calls[0]?.[0]?.context?.leagueId
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

  it('the tool loop runs, and receives the AUTHORIZED id', async () => {
    await post({ message: VALUE_MESSAGE, leagueId: 'league-private', confirmTokenSpend: 'true' })
    expect(runChimmyToolLoopMock).toHaveBeenCalledTimes(1)
    expect(toolLoopLeagueArg()).toBe(PRIVATE_LEAGUE.id)
  })

  /*
   * 🛑 THE DESCRIBED-TRADE READER WAS UNREACHED UNTIL 2026-09-16, AND THIS CONTROL IS WHY THE
   * ASSERTIONS BELOW NOW MEAN SOMETHING.
   *
   * `buildDescribedTradeContext` sits inside `runPECR`'s `plan` callback. Before, every request
   * here returned earlier, so four `it.todo`s stood in for the reader rather than assertions that
   * would have passed for the wrong reason. The previous note named two candidates for the early
   * return: the token spend and the tool loop. Measured (`AF_DEBUG_POST=1`): it was the SPEND —
   * `409 token_confirmation_required`, because no request sent `confirmTokenSpend`. The tool
   * loop was a real reader of its own, not the blocker, and is covered above.
   *
   * So every request that must reach `plan` sends `confirmTokenSpend: 'true'` — which is also
   * what a real client does. This control is the proof the reader is reached at all.
   */
  it('the described-trade reader runs, and receives the AUTHORIZED id', async () => {
    await post({ message: VALUE_MESSAGE, leagueId: 'league-private', confirmTokenSpend: 'true' })
    expect(buildDescribedTradeContextMock).toHaveBeenCalled()
    expect(describedTradeLeagueArg()).toBe(PRIVATE_LEAGUE.id)
  })
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

  /*
   * 🛑 THE STANDINGS AND HEAD-TO-HEAD LEAK. Before the fix this received 'league-private', and
   * the tools behind it would have answered "who leads The Secret Cartel?" for a stranger.
   */
  it('the tool loop is never handed the unproven id', async () => {
    await post({ message: VALUE_MESSAGE, leagueId: 'league-private', confirmTokenSpend: 'true' })
    expect(runChimmyToolLoopMock).toHaveBeenCalledTimes(1)
    expect(toolLoopLeagueArg()).toBeNull()
  })

  it('the described-trade reader is never handed the unproven id', async () => {
    await post({ message: VALUE_MESSAGE, leagueId: 'league-private', confirmTokenSpend: 'true' })
    expect(buildDescribedTradeContextMock).toHaveBeenCalled()
    expect(describedTradeLeagueArg()).toBeNull()
  })
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

  it('tool loop: same null id', async () => {
    await post({ message: VALUE_MESSAGE, leagueId: 'league-does-not-exist', confirmTokenSpend: 'true' })
    expect(runChimmyToolLoopMock).toHaveBeenCalledTimes(1)
    expect(toolLoopLeagueArg()).toBeNull()
  })

  it('described-trade reader: same null id', async () => {
    await post({ message: VALUE_MESSAGE, leagueId: 'league-does-not-exist', confirmTokenSpend: 'true' })
    expect(buildDescribedTradeContextMock).toHaveBeenCalled()
    expect(describedTradeLeagueArg()).toBeNull()
  })
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

  it('and the described-trade reader still runs — it never required a league', async () => {
    await post({ message: VALUE_MESSAGE, confirmTokenSpend: 'true' })
    expect(buildDescribedTradeContextMock).toHaveBeenCalled()
    expect(describedTradeLeagueArg()).toBeNull()
  })
})

/*
 * The /core drawer's Fast/Deep toggle (Chimmy item 5). The tool loop, on by default, used to ignore
 * the mode, so the toggle did nothing whenever it answered. It now honours a mode a client ASKED for,
 * and leaves callers that send none exactly as they were.
 */
describe('the tool loop honours an answer mode only when one is asked for', () => {
  const LOOP_TEXT = ['Chase is a top-3 dynasty WR.', 'Here is the long version: target share, age curve and schedule.'].join('\n\n')

  beforeEach(() => {
    runChimmyToolLoopMock.mockResolvedValue({ text: LOOP_TEXT, toolsUsed: ['get_player_value'], turns: 2 })
  })

  const answer = async (fields: Record<string, string>) => {
    const { res, body } = await post({ message: VALUE_MESSAGE, confirmTokenSpend: 'true', ...fields })
    expect(res.status).toBe(200)
    const json = JSON.parse(body)
    expect(json.source).toBe('chimmy_tool_loop')
    return json
  }

  it('Fast returns the short verdict and says so', async () => {
    const json = await answer({ assistantMode: 'fast_take' })
    expect(json.response).toBe('Chase is a top-3 dynasty WR.')
    expect(json.meta.mode).toBe('fast_take')
  })

  it('Deep returns the whole answer and says so', async () => {
    const json = await answer({ assistantMode: 'deep_analysis' })
    expect(json.response).toBe(LOOP_TEXT)
    expect(json.meta.mode).toBe('deep_analysis')
  })

  it('no mode keeps the full answer and claims no mode', async () => {
    const json = await answer({})
    expect(json.response).toBe(LOOP_TEXT)
    expect(json.meta).not.toHaveProperty('mode')
  })
})

/*
 * 🛑 THE DEFAULT ANSWER PATH NEVER SAVED THE CONVERSATION. The loop answers first and returned before
 * the route's only `appendChatHistory`, so those exchanges were missing from the restored transcript
 * and from the RECENT CHAT block fed back into the prompt.
 */
describe('a tool-loop answer is saved like any other', () => {
  beforeEach(() => {
    appendChatHistoryMock.mockResolvedValue(undefined)
    prismaLeagueFindUniqueMock.mockResolvedValue({ ...PRIVATE_LEAGUE, userId: 'stranger-1' })
    runChimmyToolLoopMock.mockResolvedValue({ text: 'Start Chase.', toolsUsed: ['get_my_roster'], turns: 2 })
  })

  it('writes the question and the answer, with the display the drawer restores', async () => {
    const { res, body } = await post({ message: VALUE_MESSAGE, leagueId: 'league-private', confirmTokenSpend: 'true' })
    expect(res.status).toBe(200)
    expect(JSON.parse(body).source).toBe('chimmy_tool_loop')

    const rows = appendChatHistoryMock.mock.calls.map((c) => c[0])
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant'])
    expect(rows[0]).toMatchObject({ conversationId: 'conversation-1', content: VALUE_MESSAGE, userId: 'stranger-1' })
    expect(rows[1]).toMatchObject({ content: 'Start Chase.', leagueId: PRIVATE_LEAGUE.id })
    expect(rows[1].meta.display.grounding).toMatchObject({ grounded: true, leagueId: PRIVATE_LEAGUE.id })
    expect(rows[1].meta.display.cost).toBe(15)
  })

  /* Both rows are stamped NOW(); written in parallel, a restored transcript could put the answer first. */
  it('writes the answer only after the question has been saved', async () => {
    const order: string[] = []
    appendChatHistoryMock.mockImplementation(async (row: { role: string }) => {
      order.push(`start:${row.role}`)
      await new Promise((r) => setTimeout(r, 5))
      order.push(`done:${row.role}`)
    })
    await post({ message: VALUE_MESSAGE, leagueId: 'league-private', confirmTokenSpend: 'true' })
    expect(order).toEqual(['start:user', 'done:user', 'start:assistant', 'done:assistant'])
  })

  it('still answers when the save fails', async () => {
    appendChatHistoryMock.mockRejectedValue(new Error('db down'))
    const { res, body } = await post({ message: VALUE_MESSAGE, leagueId: 'league-private', confirmTokenSpend: 'true' })
    expect(res.status).toBe(200)
    expect(JSON.parse(body).response).toBe('Start Chase.')
  })
})
