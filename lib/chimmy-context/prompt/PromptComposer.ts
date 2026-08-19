/**
 * Phase 2B — PromptComposer
 *
 * Orchestrates: bundle + intent → ordered + budgeted markdown context block.
 * No I/O, no AI. Pure transform over what the engine + classifier already
 * produced.
 *
 * Output shape:
 *   - `contextBlock`: ready to append to the chat-route system prompt.
 *   - `debug`: per-section status (rendered/dropped/truncated) + total tokens.
 */

import { applyTokenBudget, type PromptSection } from "@/lib/chimmy-context/budget/TokenBudget"
import type { ChimmyIntent } from "@/lib/chimmy-context/intent/IntentClassifier"
import { renderAllSections } from "@/lib/chimmy-context/prompt/sections"
import type { ChimmyContextBundle } from "@/lib/chimmy-context/types"

export const DEFAULT_PROMPT_BUDGET_CHARS = 2000

type Priority = PromptSection["priority"]

/** Per-section caps + priority. Tunable in one place. */
const SECTION_PROFILES: Record<
  string,
  { priority: Priority; maxChars: number; minChars?: number }
> = {
  personality: { priority: "required", maxChars: 320, minChars: 120 },
  user: { priority: "required", maxChars: 240, minChars: 60 },
  aiAccess: { priority: "required", maxChars: 220, minChars: 40 },
  activeLeague: { priority: "preferred", maxChars: 320 },
  importedHistory: { priority: "preferred", maxChars: 420 },
  replayInsights: { priority: "preferred", maxChars: 600 },
  matchup: { priority: "preferred", maxChars: 360 },
  intelligence: { priority: "preferred", maxChars: 480 },
  roster: { priority: "preferred", maxChars: 720 },
  standings: { priority: "optional", maxChars: 380 },
  rankings: { priority: "optional", maxChars: 200 },
  leagueDifficulty: { priority: "optional", maxChars: 180 },
  sportsSchedule: { priority: "preferred", maxChars: 800 },
}

/**
 * Section ordering in the final block. Required → preferred → optional, with
 * personality + user identity first to anchor the model.
 */
const SECTION_ORDER: string[] = [
  "personality",
  "user",
  "aiAccess",
  "activeLeague",
  "importedHistory",
  "replayInsights",
  "sportsSchedule",
  "matchup",
  "intelligence",
  "roster",
  "rankings",
  "leagueDifficulty",
  "standings",
]

/**
 * Intent-conditional section gating. If a section id is not in this allowlist
 * for the chosen intent (and not always-on), it is suppressed before budgeting.
 *
 * Always-on: personality, user, aiAccess, activeLeague, importedHistory.
 */
const ALWAYS_ON = new Set<string>([
  "personality",
  "user",
  "aiAccess",
  "activeLeague",
  "importedHistory",
])

const INTENT_SECTION_ALLOW: Record<ChimmyIntent, Set<string>> = {
  general: new Set(),
  sports_schedule: new Set(["sportsSchedule"]),
  matchup: new Set(["matchup", "intelligence", "roster", "standings"]),
  start_sit: new Set(["matchup", "intelligence", "roster", "rankings"]),
  waiver: new Set(["intelligence", "roster", "rankings"]),
  trade: new Set(["intelligence", "roster", "standings", "rankings", "leagueDifficulty", "replayInsights"]),
  dynasty: new Set(["intelligence", "rankings", "leagueDifficulty", "standings"]),
  rankings: new Set(["rankings", "leagueDifficulty"]),
  draft: new Set(["rankings"]),
}

export type ComposePromptOptions = {
  intent: ChimmyIntent
  budgetChars?: number
}

export type ComposedPrompt = {
  contextBlock: string
  totalChars: number
  approxTokens: number
  intent: ChimmyIntent
  sections: Array<{
    id: string
    rendered: boolean
    dropped: boolean
    truncated: boolean
    chars: number
  }>
}

export function composeChimmyPrompt(
  bundle: ChimmyContextBundle,
  options: ComposePromptOptions
): ComposedPrompt {
  const rendered = renderAllSections(bundle)
  const allowed = INTENT_SECTION_ALLOW[options.intent] ?? new Set<string>()

  const orderedSections: PromptSection[] = []
  for (const id of SECTION_ORDER) {
    const profile = SECTION_PROFILES[id]
    if (!profile) continue
    const isAllowed = ALWAYS_ON.has(id) || allowed.has(id)
    const content = isAllowed ? rendered[id] ?? "" : ""
    orderedSections.push({
      id,
      content,
      priority: profile.priority,
      maxChars: profile.maxChars,
      minChars: profile.minChars,
    })
  }

  const budgeted = applyTokenBudget(orderedSections, {
    budgetChars: options.budgetChars ?? DEFAULT_PROMPT_BUDGET_CHARS,
  })

  const contextBlock = budgeted.sections
    .filter((s) => !s.dropped && s.content.length > 0)
    .map((s) => s.content)
    .join("\n\n")

  return {
    contextBlock,
    totalChars: budgeted.totalChars,
    approxTokens: budgeted.approxTokens,
    intent: options.intent,
    sections: budgeted.sections.map((s) => ({
      id: s.id,
      rendered: !s.dropped && s.content.length > 0,
      dropped: s.dropped,
      truncated: s.truncated,
      chars: s.content.length,
    })),
  }
}
