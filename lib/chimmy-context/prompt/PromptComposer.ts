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

/*
 * ⚠ EVERY `ChimmyIntent` NEEDS AN ENTRY. A MISSING KEY IS SILENT AND SEVERE.
 *
 * `injury`, `weather`, `commissioner` and `bracket` were absent here while being fully classified
 * by IntentClassifier — and they sit at positions 2-5 of its `PRIORITY` list, so they WIN TIES
 * over start_sit, trade, waiver and matchup. The `?? new Set()` fallback below meant every one of
 * those turns rendered only the five ALWAYS_ON sections: no roster, no matchup, no rankings, no
 * standings, no league intelligence.
 *
 * The worked example, measured: "Should I start Puka Nacua? He is questionable with an ankle
 * injury" classifies as `injury` at 0.67 confidence and beats `start_sit` — so the single most
 * common in-season question was answered with the user's roster withheld from the model. Nothing
 * errored, nothing logged, and the reply still read fluently, which is why it survived.
 *
 * The `Record<ChimmyIntent, …>` annotation was already here and did NOT catch it, because the
 * repo carries a standing tsc error baseline and this was one more line in it. Do not rely on the
 * type alone — see the exhaustiveness assertion below, which fails the build instead.
 */
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

  /*
   * An injury question is nearly always a lineup question wearing a different hat ("he's
   * questionable — do I start him?"), so this mirrors start_sit and adds the schedule: whether the
   * game is soon is half the answer to whether a questionable tag matters.
   */
  injury: new Set(["matchup", "intelligence", "roster", "rankings", "sportsSchedule"]),

  /* Weather only ever matters relative to a specific game and the players in it. */
  weather: new Set(["matchup", "roster", "sportsSchedule"]),

  /* League operation: who is in the league, how it is configured, where it stands. */
  commissioner: new Set(["intelligence", "standings", "roster", "leagueDifficulty"]),

  /* Brackets have no dedicated section yet; the schedule and rankings are what exist today. */
  bracket: new Set(["sportsSchedule", "rankings", "standings"]),
}

/*
 * Compile-time exhaustiveness. Adding a member to `ChimmyIntent` without adding it above is now a
 * type error at THIS line, with the missing key named — rather than a silently empty context block
 * discovered in production. `satisfies` reports the gap even where the surrounding baseline is red.
 */
const _INTENT_ALLOW_IS_EXHAUSTIVE = INTENT_SECTION_ALLOW satisfies Record<
  ChimmyIntent,
  Set<string>
>
void _INTENT_ALLOW_IS_EXHAUSTIVE

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
