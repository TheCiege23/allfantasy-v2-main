import 'server-only'

import { isAiSpendEnabled } from '@/lib/ai/aiSpendGuard'
import { routeTextCall, type ProviderName, type RouterMessage, type RouterResult } from '@/lib/ai/providerRouter'
import { resolveProviderForFeature } from '@/lib/ai/taskProviderRouting'
import type { TradeEvaluationReceipt } from './evaluateTrade'
import { buildExplanationPacket, COUNTER_MIN_GAP_PCT, type BuildPacketOptions, type ExplanationPacket } from './explanationPacket'
import { templateVerdict } from './templateVerdict'
import { HEADLINE_MAX_CHARS, MAX_REASONS, MIN_REASONS, type TradeVerdict } from './tradeVerdict'
import { validateVerdict } from './validateVerdict'

/**
 * THE AI EXPLANATION LAYER (design build-order step 4). The engine grades; this explains the grade.
 *
 * One call per evaluation, no tools, through `providerRouter` on the `trade_eval` task route. The
 * model gets the packet (`./explanationPacket.ts`) — the receipt and nothing else — and returns a
 * strict `TradeVerdict`. `./validateVerdict.ts` checks it; on failure the model gets ONE retry with
 * the violations spelled out, and after that the deterministic template (`./templateVerdict.ts`)
 * answers instead. A caller always gets a verdict that passed the validator.
 *
 * 🛑 NO CALL AT ALL WHEN THERE IS NOTHING TO EXPLAIN OR NOTHING MAY BE SPENT. A withheld grade gets the
 * template (the model would be explaining an absence, and its reason is already in words); spend off
 * gets the template without a request. The router's own guards would refuse too — checking first is
 * what lets the result say WHY it is a template instead of reading as a provider outage.
 */

export type ExplanationSource = 'ai' | 'template'
export type TemplateReason = 'withheld' | 'spend_disabled' | 'provider_failed' | 'invalid_output'

export type TradeExplanation = {
  verdict: TradeVerdict
  source: ExplanationSource
  /** Why the template answered. Null when the model's answer was used. */
  templateReason: TemplateReason | null
  /** Model calls made: 0, 1 or 2. */
  attempts: number
  provider: ProviderName | null
  /** The last failed attempt's violations, for logs. Never shown to a manager. */
  violations: string[]
  receiptId: string | null
}

export type ExplainTradeDeps = {
  route: (args: Parameters<typeof routeTextCall>[0]) => Promise<RouterResult>
  spendEnabled: () => boolean
  preferredProvider: () => ProviderName | null
}

export const defaultExplainTradeDeps: ExplainTradeDeps = {
  route: routeTextCall,
  spendEnabled: isAiSpendEnabled,
  preferredProvider: () => resolveProviderForFeature('trade_eval')?.provider ?? null,
}

export const EXPLAIN_TRADE_SYSTEM_PROMPT = `You explain a fantasy trade grade that AllFantasy's trade engine has ALREADY decided. You never grade, price or re-value anything.

You receive one JSON packet. It is the only source of facts. Return ONLY a JSON object with exactly these keys:
{
  "verdict": <copy packet.fixed.verdict>,
  "headline": string (${HEADLINE_MAX_CHARS} characters or fewer, plain language),
  "grades": [{"teamId":"teamA","grade":<packet.fixed.grades.teamA>},{"teamId":"teamB","grade":<packet.fixed.grades.teamB>}] (an empty array when packet.fixed.grades is null),
  "reasons": [{"text": string, "evidence": [packet paths]}],
  "risks": [string],
  "counter": {"add": [asset names], "remove": [asset names], "why": string} (OPTIONAL — omit the key unless allowed),
  "confidence": <copy packet.fixed.confidence>
}

Rules:
1. Use only numbers that appear in the packet. Never state a projection, stat, value, percentage, week or injury detail that is not in it. Rounding a packet number is fine; any other number is not.
2. Copy verdict, grades and confidence from packet.fixed exactly. Never state a different letter grade anywhere in the text.
3. Give ${MIN_REASONS} to ${MAX_REASONS} reasons. Each cites at least one packet path in "evidence", written as dot paths with [i] for arrays, e.g. "values.teamAReceives" or "assets.teamASends[0].leagueValue". Every path must exist in the packet.
4. When packet.lineup.teamA or packet.seasonOutlook is not null, reason 1 is Team A's lineup impact and cites "lineup.teamA..." or "seasonOutlook.teamA...". Asset value comes after.
5. Name at least one risk. packet.riskCandidates lists the risks the data shows; say them in plain words.
6. Include "counter" only when packet.counter.allowed is true (a gap of ${COUNTER_MIN_GAP_PCT}% or more), naming only assets from packet.counter.assetNames.
7. Advisory voice. No odds, locks, guarantees, bets, wagers, parlays or other betting or certainty language.
8. Write for Team A, called by the name in packet.teams.teamA. No markdown.`

function userPrompt(packet: ExplanationPacket): string {
  return `PACKET:\n${JSON.stringify(packet)}`
}

function retryPrompt(violations: string[]): string {
  return [
    'Your answer failed these checks:',
    ...violations.slice(0, 20).map((v) => `- ${v}`),
    'Return the corrected JSON object only.',
  ].join('\n')
}

/** The model's text as JSON, tolerating a code fence. Null when it is not a JSON object. */
export function parseVerdictJson(text: string): unknown {
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const value = JSON.parse(cleaned.slice(start, end + 1))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

export type ExplainTradeInput = { receipt: TradeEvaluationReceipt } & BuildPacketOptions

export async function explainTrade(
  input: ExplainTradeInput,
  deps: Partial<ExplainTradeDeps> = {},
): Promise<TradeExplanation> {
  const d: ExplainTradeDeps = { ...defaultExplainTradeDeps, ...deps }
  const packet = buildExplanationPacket(input.receipt, input)
  const template = (templateReason: TemplateReason, attempts: number, provider: ProviderName | null, violations: string[]): TradeExplanation => ({
    verdict: templateVerdict(packet),
    source: 'template',
    templateReason,
    attempts,
    provider,
    violations,
    receiptId: packet.receiptId,
  })

  if (!packet.graded) return template('withheld', 0, null, [])
  if (!d.spendEnabled()) return template('spend_disabled', 0, null, [])

  const messages: RouterMessage[] = [
    { role: 'system', content: EXPLAIN_TRADE_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt(packet) },
  ]
  const preferredProvider = d.preferredProvider()
  let violations: string[] = []
  let provider: ProviderName | null = null

  for (let attempt = 1; attempt <= 2; attempt++) {
    let result: RouterResult
    try {
      result = await d.route({ messages, maxTokens: 900, temperature: 0.2, skipCache: attempt > 1, preferredProvider })
    } catch {
      result = { ok: false }
    }
    if (!result.ok) return template('provider_failed', attempt, provider, violations)
    provider = result.provider

    const raw = parseVerdictJson(result.text)
    const checked = raw === null ? { ok: false as const, violations: ['schema: the answer is not a JSON object'] } : validateVerdict(raw, packet)
    if (checked.ok) {
      return { verdict: checked.verdict, source: 'ai', templateReason: null, attempts: attempt, provider, violations: [], receiptId: packet.receiptId }
    }
    violations = checked.violations
    /*
     * ⚠ ONE USER MESSAGE, NOT A SECOND TURN. The router's Anthropic adapter sends only the LAST user
     * message (`extractSystemAndUser`), so an assistant/user pair appended here would reach Anthropic
     * as the retry note alone — without the packet it is meant to be checked against.
     */
    messages[1] = {
      role: 'user',
      content: `${userPrompt(packet)}\n\nYOUR PREVIOUS ANSWER:\n${result.text}\n\n${retryPrompt(violations)}`,
    }
  }
  return template('invalid_output', 2, provider, violations)
}
