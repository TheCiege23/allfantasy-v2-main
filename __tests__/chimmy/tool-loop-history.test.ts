import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'
import { CHIMMY_GENERIC_ERROR_MESSAGE } from '@/lib/chimmy-chat/response-copy'

/**
 * Tool-loop answers reach `chat_history` (2026-09-28), with the polish needed to redraw them.
 *
 * Found in #1552: the TOOL LOOP — the path that answers most messages, and the only one that runs
 * `get_faab_bid_plan` / `optimize_my_lineup` / `get_my_matchup` — returned without calling
 * `appendChatHistory`, unlike every other return. So those answers vanished from the transcript on
 * reload, and "Newer answer below" could not survive a new tab.
 *
 * 🛑 AND WRITING HISTORY MUST NOT CHANGE WHAT IS CHARGED. The write sits after the spend and after
 * the undelivered-answer refund, and only copies what they decided. Pinned below in both directions:
 * the charge is identical whether the history write succeeds or throws, and a refunded answer is
 * stored at cost 0.
 *
 * Drives the REAL POST/GET handlers, with the harness of `chimmy-unproven-league-id-readers.test.ts`
 * (see its notes for why each mock exists). The loop itself is mocked and fills the tool context the
 * way the real tools do — that context is the channel under test.
 */

const h = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  runAiProtection: vi.fn(),
  enrichChatWithData: vi.fn(),
  runUnifiedOrchestration: vi.fn(),
  requestContractToUnified: vi.fn(),
  unifiedResponseToContract: vi.fn(),
  validateToolRequest: vi.fn(),
  buildChimmyConversationId: vi.fn(),
  appendChatHistory: vi.fn(),
  getRecentChatHistory: vi.fn(),
  buildAgentPrompt: vi.fn(),
  inferAgentFromMessage: vi.fn(),
  getChimmyMemoryContext: vi.fn(),
  resolveNormalizedLeagueContext: vi.fn(),
  resolveChimmyPersonalizationProfile: vi.fn(),
  resolveChimmyLeagueSelection: vi.fn(),
  detectManagerAmbiguity: vi.fn(),
  buildChimmyStalenessWarning: vi.fn(),
  buildChimmySourceReferences: vi.fn(),
  buildChimmySportDataDigest: vi.fn(),
  getInsightBundle: vi.fn(),
  userProfileFindUnique: vi.fn(),
  userProfileUpsert: vi.fn(),
  appUserFindUnique: vi.fn(),
  aiCustomRuleFindMany: vi.fn(),
  leagueFindUnique: vi.fn(),
  redraftMemberFindUnique: vi.fn(),
  rosterCount: vi.fn(),
  leagueTeamFindFirst: vi.fn(),
  previewSpend: vi.fn(),
  spendTokensForRule: vi.fn(),
  refundSpendByLedger: vi.fn(),
  tryDeterministicAnswerDetailed: vi.fn(),
  buildDescribedTradeContext: vi.fn(),
  runChimmyToolLoop: vi.fn(),
}))

vi.mock('@/lib/chimmy/tools/chimmyToolLoop', () => ({ runChimmyToolLoop: h.runChimmyToolLoop }))
vi.mock('next-auth', () => ({ getServerSession: h.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/ai-protection', () => ({ runAiProtection: h.runAiProtection }))
vi.mock('@/lib/chat-data-enrichment', () => ({ enrichChatWithData: h.enrichChatWithData }))
vi.mock('@/lib/ai-orchestration/orchestration-service', () => ({ runUnifiedOrchestration: h.runUnifiedOrchestration }))
vi.mock('@/lib/ai-tool-registry', () => ({
  requestContractToUnified: h.requestContractToUnified,
  unifiedResponseToContract: h.unifiedResponseToContract,
  validateToolRequest: h.validateToolRequest,
}))
vi.mock('@/lib/ai-simulation-integration', () => ({ getInsightBundle: h.getInsightBundle }))
vi.mock('@/lib/ai/deterministic', () => ({
  isOwnRosterInjuryQuestion: () => false,
  tryDeterministicAnswerDetailed: h.tryDeterministicAnswerDetailed,
  DETERMINISTIC_SOURCE: 'deterministic' as const,
}))
vi.mock('@/lib/chimmy-trade/describedTradeEvaluator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chimmy-trade/describedTradeEvaluator')>()),
  buildDescribedTradeContext: h.buildDescribedTradeContext,
}))
vi.mock('@/lib/league-context-engine', () => ({ resolveNormalizedLeagueContext: h.resolveNormalizedLeagueContext }))
vi.mock('@/lib/ai-memory/chimmy-memory-context', () => ({ getChimmyMemoryContext: h.getChimmyMemoryContext }))
vi.mock('@/lib/agents/pipeline', () => ({ buildAgentPrompt: h.buildAgentPrompt, inferAgentFromMessage: h.inferAgentFromMessage }))
vi.mock('@/lib/tokens/TokenSpendService', () => ({
  TokenInsufficientBalanceError: class TokenInsufficientBalanceError extends Error {},
  TokenSpendConfirmationRequiredError: class TokenSpendConfirmationRequiredError extends Error {},
  TokenSpendRuleNotFoundError: class TokenSpendRuleNotFoundError extends Error {},
  TokenSpendService: class {
    previewSpend = h.previewSpend
    spendTokensForRule = h.spendTokensForRule
    refundSpendByLedger = h.refundSpendByLedger
  },
}))
vi.mock('@/lib/chimmy-personalization/service', () => ({ resolveChimmyPersonalizationProfile: h.resolveChimmyPersonalizationProfile }))
vi.mock('@/lib/chimmy/chimmy-league-resolution', () => ({
  resolveChimmyLeagueSelection: h.resolveChimmyLeagueSelection,
  detectManagerAmbiguity: h.detectManagerAmbiguity,
  buildChimmyStalenessWarning: h.buildChimmyStalenessWarning,
  buildChimmySourceReferences: h.buildChimmySourceReferences,
}))
vi.mock('@/lib/chimmy/chimmy-sport-data-digest', () => ({ buildChimmySportDataDigest: h.buildChimmySportDataDigest }))
vi.mock('@/lib/ai-memory/chat-history-store', () => ({
  buildChimmyConversationId: h.buildChimmyConversationId,
  appendChatHistory: h.appendChatHistory,
  getRecentChatHistory: h.getRecentChatHistory,
}))
vi.mock('@/lib/ai-memory/ai-memory-store', () => ({
  rememberChimmyAssistantMemory: vi.fn(),
  rememberChimmyUserMessageMemory: vi.fn(),
  getAiMemory: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    appUser: { findUnique: h.appUserFindUnique },
    userProfile: { findUnique: h.userProfileFindUnique, upsert: h.userProfileUpsert },
    aICustomRule: { findMany: h.aiCustomRuleFindMany },
    league: { findUnique: h.leagueFindUnique },
    redraftLeagueMember: { findUnique: h.redraftMemberFindUnique },
    roster: { count: h.rosterCount },
    leagueTeam: { findFirst: h.leagueTeamFindFirst },
  },
}))

/** The caller's own league, so membership resolves and the loop is handed its id. */
const LEAGUE = {
  id: 'league-chop', userId: 'user-1', name: 'Test Chop Shop', sport: 'nfl', platform: 'sleeper', platformLeagueId: '123456',
  season: 2026, leagueSize: 16, scoring: 'ppr', leagueVariant: null, isDynasty: false, status: 'in_season',
  timezone: 'America/Chicago', lastSyncedAt: new Date('2026-09-28T00:00:00.000Z'), importBatchId: null, importedAt: null,
}

/* A value question: needs no league, clears the sports-content deflection (see the harness notes). */
const MESSAGE = 'What is Ja’Marr Chase worth in fantasy football?'
const LOOP_TEXT = 'You are safe this week: every game that matters has finished.'
const SAFE = { verdict: 'safe' as const, finishedBelow: 3, chops: 1 }

vi.setConfig({ testTimeout: 120000 })

const toolLoopEnvBefore = process.env.CHIMMY_TOOL_LOOP_ENABLED
afterEach(() => {
  if (toolLoopEnvBefore === undefined) delete process.env.CHIMMY_TOOL_LOOP_ENABLED
  else process.env.CHIMMY_TOOL_LOOP_ENABLED = toolLoopEnvBefore
})

type LoopArgs = { context: { leagueId: string | null; eliminationSettles?: unknown[]; toolRuns?: unknown[] } }

/** A loop that ran `get_my_matchup` (and `optimize_my_lineup`) for the bound league, as the real tools record it. */
function loopAnswers(text: string, settle: unknown = SAFE, settleLeagueId: string = LEAGUE.id) {
  h.runChimmyToolLoop.mockImplementation(async ({ context }: LoopArgs) => {
    context.eliminationSettles?.push({ leagueId: settleLeagueId, settle })
    context.toolRuns?.push({ tool: 'optimize_my_lineup', leagueId: LEAGUE.id })
    return { text, toolsUsed: ['get_my_matchup', 'optimize_my_lineup'], turns: 2, provider: 'claude' }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CHIMMY_TOOL_LOOP_ENABLED = 'true'
  h.getServerSession.mockResolvedValue({ user: { id: 'user-1' } })
  h.runAiProtection.mockResolvedValue(null)
  h.enrichChatWithData.mockResolvedValue({ context: '', audit: { sourcesUsed: [] } })
  h.validateToolRequest.mockReturnValue({ valid: true })
  h.buildChimmyConversationId.mockReturnValue('chimmy:user-1')
  h.appendChatHistory.mockResolvedValue(undefined)
  h.getRecentChatHistory.mockResolvedValue([])
  h.buildAgentPrompt.mockImplementation(async ({ userMessage }: { userMessage: string }) => userMessage)
  h.inferAgentFromMessage.mockReturnValue('trade_analyzer')
  h.getChimmyMemoryContext.mockResolvedValue({ promptSection: '' })
  h.resolveNormalizedLeagueContext.mockResolvedValue({ ok: true, context: {} })
  h.resolveChimmyPersonalizationProfile.mockResolvedValue(null)
  h.resolveChimmyLeagueSelection.mockResolvedValue({ kind: 'ask', message: 'Which league?', choices: [], leagues: [] })
  h.detectManagerAmbiguity.mockReturnValue({ kind: 'ok' })
  h.buildChimmyStalenessWarning.mockReturnValue({ warning: null, staleMinutes: 1, thresholdMinutes: 10 })
  h.buildChimmySourceReferences.mockReturnValue([])
  h.buildChimmySportDataDigest.mockResolvedValue({ text: '', sources: [] })
  h.appUserFindUnique.mockResolvedValue({ emailVerified: new Date('2025-01-01') })
  h.userProfileUpsert.mockResolvedValue({
    userId: 'user-1', displayName: null, phone: null, phoneVerifiedAt: null, emailVerifiedAt: null,
    ageConfirmedAt: new Date('2025-01-01'), profileComplete: true,
  })
  h.userProfileFindUnique.mockResolvedValue(null)
  h.aiCustomRuleFindMany.mockResolvedValue([])
  h.leagueFindUnique.mockResolvedValue(LEAGUE)
  h.redraftMemberFindUnique.mockResolvedValue(null)
  h.rosterCount.mockResolvedValue(0)
  h.leagueTeamFindFirst.mockResolvedValue(null)
  h.getInsightBundle.mockResolvedValue(null)
  h.tryDeterministicAnswerDetailed.mockResolvedValue(null)
  h.buildDescribedTradeContext.mockResolvedValue(null)
  h.previewSpend.mockResolvedValue({ ruleCode: 'ai_chimmy_chat_message', tokenCost: 15, canSpend: true, currentBalance: 20 })
  h.spendTokensForRule.mockResolvedValue({ id: 'ledger-1', balanceAfter: 5 })
  h.refundSpendByLedger.mockResolvedValue({ balanceAfter: 20 })
  h.requestContractToUnified.mockReturnValue({ envelope: {} })
  loopAnswers(LOOP_TEXT)
})

async function post(fields: Record<string, string> = {}) {
  const fd = new FormData()
  for (const [k, v] of Object.entries({ message: MESSAGE, leagueId: LEAGUE.id, confirmTokenSpend: 'true', ...fields })) fd.append(k, v)
  const { POST } = await import('@/app/api/chat/chimmy/route')
  const res = await POST(createMockNextRequest('http://localhost/api/chat/chimmy', { method: 'POST', body: fd }) as never)
  const json = JSON.parse(await res.text())
  return { status: res.status, json }
}

/** The two rows the route wrote, by role. */
function writtenRows() {
  const calls = h.appendChatHistory.mock.calls.map((c) => c[0] as { role: string; content: string; leagueId: string | null; meta?: { display?: Record<string, unknown> } })
  return { user: calls.find((c) => c.role === 'user'), assistant: calls.find((c) => c.role === 'assistant'), count: calls.length }
}

describe('a tool-loop answer is written to chat history', () => {
  it('both halves, under the proven league, with the chip and supersede keys the response carried', async () => {
    const { status, json } = await post()
    expect(status).toBe(200)
    expect(json.source).toBe('chimmy_tool_loop')

    const rows = writtenRows()
    expect(rows.count).toBe(2)
    expect(rows.user).toMatchObject({ conversationId: 'chimmy:user-1', content: MESSAGE, userId: 'user-1', leagueId: LEAGUE.id })
    expect(rows.assistant).toMatchObject({ conversationId: 'chimmy:user-1', content: LOOP_TEXT, userId: 'user-1', leagueId: LEAGUE.id })

    const display = rows.assistant!.meta!.display!
    expect(display.verdict).toEqual({ key: 'safe', source: 'elimination_settle', detail: 'Week decided' })
    expect(display.verdict).toEqual(json.meta.verdict)
    expect(display.answerKeys).toEqual(['optimize_my_lineup:league-chop'])
    expect(display.answerKeys).toEqual(json.meta.answerKeys)
    expect(display.grounding).toMatchObject({ grounded: true, leagueId: LEAGUE.id })
    expect(display.cost).toBe(15)
  })
})

describe('writing history does not change what is charged', () => {
  it('the charge is identical whether the history write succeeds or throws', async () => {
    const ok = await post()
    const okSpend = h.spendTokensForRule.mock.calls.map((c) => c[0])
    expect(okSpend).toHaveLength(1)
    expect(okSpend[0]).toMatchObject({ userId: 'user-1', ruleCode: 'ai_chimmy_chat_message' })
    expect(h.refundSpendByLedger).not.toHaveBeenCalled()

    vi.clearAllMocks()
    h.spendTokensForRule.mockResolvedValue({ id: 'ledger-1', balanceAfter: 5 })
    h.appendChatHistory.mockRejectedValue(new Error('history table unavailable'))
    const failed = await post()

    expect(failed.status).toBe(200)
    expect(failed.json.response).toBe(LOOP_TEXT)
    expect(h.appendChatHistory).toHaveBeenCalled()
    expect(h.spendTokensForRule.mock.calls.map((c) => c[0])).toEqual(okSpend)
    expect(h.refundSpendByLedger).not.toHaveBeenCalled()
    expect(failed.json.meta.tokenSpend).toEqual(ok.json.meta.tokenSpend)
    expect(ok.json.meta.tokenSpend).toMatchObject({ tokenCost: 15, balanceAfter: 5, ledgerId: 'ledger-1' })
  })

  it('an undelivered answer is refunded exactly as before, stored at cost 0 and with no chip', async () => {
    loopAnswers(CHIMMY_GENERIC_ERROR_MESSAGE)
    const { json } = await post()
    expect(h.spendTokensForRule).toHaveBeenCalledTimes(1)
    expect(h.refundSpendByLedger).toHaveBeenCalledTimes(1)
    expect(json.meta.tokenSpend).toMatchObject({ tokenCost: 0, refunded: true })
    expect(json.meta).not.toHaveProperty('verdict')

    const display = writtenRows().assistant!.meta!.display!
    expect(display.cost).toBe(0)
    expect(display).not.toHaveProperty('verdict')
    expect(display).not.toHaveProperty('answerKeys')
  })
})

describe('SAFE / OUT from the guillotine settle verdict', () => {
  it('safe → SAFE and chopped → OUT, from the settle object', async () => {
    const safe = await post()
    expect(safe.json.meta.verdict).toEqual({ key: 'safe', source: 'elimination_settle', detail: 'Week decided' })

    loopAnswers(LOOP_TEXT, { verdict: 'chopped', chops: 1 })
    const out = await post()
    expect(out.json.meta.verdict).toEqual({ key: 'out', source: 'elimination_settle', detail: 'Week decided' })
  })

  it('an open week, no chop, or no settle read gets no chip — even when the prose says "safe"', async () => {
    for (const settle of [
      { verdict: 'open', yourUpcoming: 0, yourLive: 1, yourUnknown: 0, finishedBelow: 0, chops: 1, cutLinePending: 2 },
      { verdict: 'no_chop' },
      null,
    ]) {
      loopAnswers(LOOP_TEXT, settle)
      const { json } = await post()
      expect(json.meta).not.toHaveProperty('verdict')
    }
  })

  it('a settle read for a different league than the one the answer reports gets no chip', async () => {
    loopAnswers(LOOP_TEXT, SAFE, 'league-somewhere-else')
    const { json } = await post()
    expect(json.meta.leagueGrounding).toMatchObject({ leagueId: LEAGUE.id })
    expect(json.meta).not.toHaveProperty('verdict')
  })
})

describe('the history read gives the polish back, through the drawer\'s own readers', () => {
  async function get() {
    const { GET } = await import('@/app/api/chat/chimmy/route')
    const res = await GET(createMockNextRequest('http://localhost/api/chat/chimmy?leagueId=global') as never)
    return JSON.parse(await res.text()) as { turns: Array<Record<string, unknown>> }
  }

  it('restores a stored chip and keys, and drops a malformed one rather than trusting the row', async () => {
    h.getRecentChatHistory.mockResolvedValue([
      { role: 'assistant', content: 'You are safe.', createdAt: new Date('2026-09-28T01:00:00Z'), leagueId: LEAGUE.id,
        meta: { display: { cost: 15, verdict: { key: 'safe', source: 'elimination_settle', detail: 'Week decided' }, answerKeys: ['optimize_my_lineup:league-chop', 'not_a_tool:x'] } } },
      { role: 'assistant', content: 'Made-up chip.', createdAt: new Date('2026-09-28T01:01:00Z'), leagueId: LEAGUE.id,
        meta: { display: { verdict: { key: 'definitely', source: 'the_model' }, faabPlan: { version: 2 } } } },
    ])
    const { turns } = await get()
    expect(turns[0]).toMatchObject({ role: 'chimmy', verdict: { key: 'safe', source: 'elimination_settle' }, answerKeys: ['optimize_my_lineup:league-chop'], cost: 15 })
    expect(turns[1]).not.toHaveProperty('verdict')
    expect(turns[1]).not.toHaveProperty('faabPlan')
    expect(turns[1]).not.toHaveProperty('answerKeys')
  })
})
