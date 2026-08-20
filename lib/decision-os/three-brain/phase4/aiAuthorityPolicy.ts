/**
 * Phase 4 — how much authority the AI has, PER DECISION TYPE.
 *
 * The Decision Registry states a single blanket rule ("AI is explanation-only, never in the verdict
 * path"). That rule is right for decisions that move a roster or spend money, and too strict for
 * league narrative, where an AI-written recap is the product rather than a risk. So authority is
 * resolved per decision type instead of globally.
 *
 * The split is deliberate and load-bearing in BOTH directions:
 *
 *   - Loosening it for trade/waiver/lineup would destroy the system's core value. A recommendation
 *     that moves a roster has to be reproducible and defensible; the moment a model can author it,
 *     it cannot be either.
 *   - Applying it to recaps and storylines would block a feature that is supposed to be AI-written.
 *
 * FAIL-CLOSED. `resolveAiAuthority` returns `explanation_only` for anything not listed. A decision
 * type must EARN authoring rights by being named here — it must never acquire them by omission,
 * which is exactly how a future money-consequence decision would otherwise end up model-authored.
 *
 * PURE — no DB, no I/O, no clock.
 */

export type AiAuthority =
  /** AI may rewrite the explanation and nothing else. Verdicts, actions and confidence stay the
   *  deterministic engine's. This is the default and the safe direction to be wrong in. */
  | 'explanation_only'
  /** AI may author the content itself. Only for output with no roster or money consequence. */
  | 'may_author'

/**
 * Decisions whose outcome moves a roster, spends a budget, or changes standing. Listed explicitly
 * so the intent is legible at review time even though these are also what the default would give.
 */
const CONSEQUENTIAL_DECISIONS = [
  'manager.lineup.set',
  'manager.waiver.claim',
  'manager.trade.evaluate',
  'commissioner.league.health',
  // The Phase 2 tool identifiers reach this code as `decisionType` on some paths.
  'manager_intelligence',
  'user_os',
  'mission_control',
  'commissioner_command_center',
] as const

/**
 * Narrative output with no roster or money consequence. Being wrong here costs a bad sentence, not
 * a bad trade. Anything added to this list should be readable in isolation and carry no action.
 */
const NARRATIVE_DECISIONS = [
  'league.recap.weekly',
  'league.storyline',
  'league.power_rankings',
  'league.narrative',
] as const

const AUTHORITY: ReadonlyMap<string, AiAuthority> = new Map<string, AiAuthority>([
  ...CONSEQUENTIAL_DECISIONS.map((d) => [d, 'explanation_only'] as const),
  ...NARRATIVE_DECISIONS.map((d) => [d, 'may_author'] as const),
])

/** Fail-closed: anything unlisted is `explanation_only`. */
export function resolveAiAuthority(decisionType: string | null | undefined): AiAuthority {
  if (!decisionType) return 'explanation_only'
  return AUTHORITY.get(decisionType) ?? 'explanation_only'
}

/** True when the AI may only rewrite prose for this decision — never author the action. */
export function isExplanationOnly(decisionType: string | null | undefined): boolean {
  return resolveAiAuthority(decisionType) === 'explanation_only'
}

/** The decision types explicitly granted authoring rights. Exposed so a test can assert the list
 *  contains nothing consequential, rather than trusting review to catch it. */
export function authoringDecisionTypes(): readonly string[] {
  return NARRATIVE_DECISIONS
}
