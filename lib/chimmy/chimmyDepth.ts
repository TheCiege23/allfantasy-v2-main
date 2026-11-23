/**
 * How deep Chimmy goes for this user — the AF Pro depth package (owner's decision 2026-11-16).
 *
 * Until now a paid answer was the same answer as a free one; a subscription bought only MORE of them
 * (`planAllowance.ts`: 100 a day against 2). Now the plan that includes Chimmy (AF Pro, and AF Supreme
 * which bundles it — whoever `EntitlementResolver` says holds `ai_chat`) also buys a DEEPER answer:
 *
 *   1. Deeper research — more tool turns before the model must answer, and room for a longer answer
 *      on the OpenAI-shaped providers (Claude already allows 8000 tokens).
 *   2. Longer memory — more of the current conversation reaches the model.
 *   3. Recall past chats — `recall_past_chats` searches the user's own earlier Chimmy conversations.
 *   4. Pro analyst tools — the playoff simulator, trade ideas and FAAB bid plans.
 *
 * FREE IS EXACTLY WHAT EVERYONE HAD BEFORE, minus (4) and without (3): 4 turns, 1200-token answers, 6
 * loop turns / 8 fallback turns of memory. A free user who asks for a Pro tool is refused by the
 * executor itself — the gate does not rest on the model choosing not to call it — and the refusal
 * puts an "AF Pro adds …" line with an upgrade button under the answer (owner's choice, 2026-11-16).
 * The model is told NOT to say it too: measured on the first render, prose and box both said "AF
 * Pro adds the playoff simulator" one line apart.
 * An answer that used `recall_past_chats` shows a "From your past chats" chip.
 *
 * Pure: no server imports, so the route, the private-reply path and the tests share one definition.
 */

import { PRO_ONLY_TOOL_LABEL, type ChimmyProOnlyTool } from '@/lib/chimmy/answerPolish'

export type ChimmyDepthTier = 'free' | 'pro'

export type ChimmyDepth = {
  tier: ChimmyDepthTier
  /** Provider calls per message; the last must answer (see MAX_TOOL_TURNS in chimmyToolLoop.ts). */
  maxToolTurns: number
  /** Answer cap on the OpenAI-shaped providers (Grok / DeepSeek / OpenAI). */
  maxAnswerTokens: number
  /** Conversation turns the tool loop sees. */
  loopConversationTurns: number
  /** Conversation turns the fallback (PECR) prompt sees. */
  fallbackConversationTurns: number
}

/**
 * Tools only a plan that includes Chimmy may run. The heavy analyst work (a season simulation, a
 * league-wide trade search, a FAAB bid model) and the cross-conversation memory read.
 */
/** Gated by their own entitlement inside the tool, not by the Chimmy plan — on the label map for the button only. */
export const OWN_GATE_CHIMMY_TOOLS: readonly ChimmyProOnlyTool[] = ['get_manager_record', 'get_player_projection', 'evaluate_trade']

export const PRO_ONLY_CHIMMY_TOOLS = (Object.keys(PRO_ONLY_TOOL_LABEL) as ChimmyProOnlyTool[]).filter(
  (t) => !OWN_GATE_CHIMMY_TOOLS.includes(t),
) as readonly ChimmyProOnlyTool[]

export const CHIMMY_DEPTH: Record<ChimmyDepthTier, ChimmyDepth> = {
  // Byte-for-byte what every user got before this package.
  free: { tier: 'free', maxToolTurns: 4, maxAnswerTokens: 1200, loopConversationTurns: 6, fallbackConversationTurns: 8 },
  pro: { tier: 'pro', maxToolTurns: 7, maxAnswerTokens: 2400, loopConversationTurns: 20, fallbackConversationTurns: 20 },
}

/**
 * The depth for a plan state from `readChimmyAnswerAllowance` / `readChimmyPlanAllowance`. Pro only on a
 * POSITIVE read of a plan that includes Chimmy — an unknown or missing state is free, never paid on a
 * guess. Stays Pro after the day's included answers are used: the subscriber still holds the plan
 * and is paying tokens for the extra answer.
 */
export function chimmyDepthForPlan(state: { kind?: 'free' | 'plan' } | null | undefined): ChimmyDepth {
  return state && state.kind !== 'free' ? CHIMMY_DEPTH.pro : CHIMMY_DEPTH.free
}

export function isProOnlyChimmyTool(name: string): boolean {
  return (PRO_ONLY_CHIMMY_TOOLS as readonly string[]).includes(name)
}

/** What the executor returns when a free user's answer reaches for a Pro tool. Read by the model. */
export function proOnlyToolMessage(name: string): string {
  const label = PRO_ONLY_TOOL_LABEL[name as ChimmyProOnlyTool] ?? 'this analysis'
  return `NOT RUN: ${label} is an AF Pro feature and this user is on the free plan. Answer as well as you can from the other tools. Do NOT mention AF Pro, upgrading or this tool: a line saying AF Pro adds ${label}, with an upgrade button, is shown under your answer automatically, and saying it twice is noise. Do not estimate what it would have said.`
}

/** Prefixed to a Pro tool's description in a free user's list. */
export const FREE_PLAN_TOOL_NOTE =
  'AF PRO ONLY — this user is on the free plan, so this returns NOT RUN. Call it only when the question genuinely needs it (that is how the user is shown the AF Pro option), then answer from the other tools. '

/**
 * The tool list a depth is offered. AF Pro: every tool as written. Free: every tool too, but each Pro
 * one is MARKED as such — deliberately not removed. A free user asking "what are my playoff odds?"
 * should be told AF Pro adds the simulator, with a button, and the button rests on the executor's
 * refusal (`ctx.proToolsRefused`), never on the model's wording. A tool the model was never offered
 * can never be refused, so leaving it out would leave the button with nothing true to rest on.
 */
export function toolSpecsForDepth<T extends { function: { name: string; description?: string } }>(specs: readonly T[], depth: ChimmyDepth): T[] {
  if (depth.tier === 'pro') return [...specs]
  return specs.map((s) =>
    isProOnlyChimmyTool(s.function.name)
      ? { ...s, function: { ...s.function, description: FREE_PLAN_TOOL_NOTE + (s.function.description ?? '') } }
      : s,
  )
}

/**
 * One line for the per-user part of the prompt, so the model knows what this user's plan allows and
 * neither promises a free user a Pro analysis nor skimps on a Pro one.
 */
export function chimmyDepthPromptLine(depth: ChimmyDepth): string {
  if (depth.tier === 'pro') {
    return `PLAN: this user has AF Pro. Research as deeply as the question needs (up to ${depth.maxToolTurns - 1} rounds of tools) — combine standings, schedule, values and history when they bear on the answer — and give the full reasoning. Earlier chats: recall_past_chats.`
  }
  return 'PLAN: this user is on the free plan. The playoff simulator, trade ideas, FAAB bid plans, recalling past chats and the draft pick outlook (who is likely gone before their pick) are AF Pro tools that will not run here. If the question genuinely needs one, call it anyway — the app then shows the user one line and an upgrade button under your answer — and answer from the other tools without mentioning AF Pro yourself. Never call one just to advertise it.'
}
