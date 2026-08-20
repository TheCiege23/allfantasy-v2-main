/**
 * Chimmy league-grounding gate (extracted in slice 12's honesty pass so the
 * rules are unit-testable rather than only inspectable).
 *
 * Contract: decisions about a user's ACTUAL team must be backed by that
 * team's league data. This module decides (a) whether grounding is required
 * for a request, and (b) whether a structured context actually constitutes
 * league grounding.
 *
 * Deliberately NOT a content filter: general strategy questions ("how does
 * superflex scoring work?") carry none of these markers and pass through.
 */

/** Intents that are inherently about the user's own team. */
export const LEAGUE_GROUNDED_INTENTS = [
  'trade_evaluation',
  'waiver_wire',
  'matchup_simulator',
  'dynasty_legacy',
  'player_comparison',
  // Added in slice 12: draft/keeper advice about a real roster was previously
  // exempt, so it could be answered with zero league data.
  'draft_help',
] as const

/** Entry-point sources that imply a team-specific surface. */
const GROUNDED_SOURCE_MARKERS = ['trade', 'waiver', 'lineup', 'draft', 'roster'] as const

/**
 * Decision verbs and possessives. The pre-slice-12 pattern missed the most
 * common ones outright — add, drop, claim, pick up, keep, flex, cut, stash,
 * sell, buy low, "should I", "who should" — so a question like
 * "should I drop Gibbs for the trending RB?" bypassed grounding entirely.
 */
const GROUNDED_MESSAGE_PATTERN =
  /\b(trade|waiver|lineup|start|sit|bench|flex|add|drop|claim|pick up|pickup|keep|keeper|draft|cut|stash|sell|buy low|sell high|my team|my roster|my guys|should i|who should|future|next season|for my team)\b/

export function requiresLeagueGroundingFor(input: {
  intent: string
  userMessage: string
  source?: string | null
  teamId?: string | null
}): boolean {
  if (input.teamId) return true
  if ((LEAGUE_GROUNDED_INTENTS as readonly string[]).includes(input.intent)) return true

  const source = String(input.source ?? '').toLowerCase()
  if (GROUNDED_SOURCE_MARKERS.some((marker) => source.includes(marker))) return true

  return GROUNDED_MESSAGE_PATTERN.test(input.userMessage.toLowerCase())
}

/**
 * A structured fantasy context counts as LEAGUE grounding only if it carries a
 * non-empty `league` block. The context assembler returns a players-only
 * object (`{ players }`, or `{ players, crossLeague }`) when the league row
 * can't be loaded — truthy, but not league grounding.
 */
export function isLeagueGroundedContext(context: Record<string, unknown> | null | undefined): boolean {
  if (!context) return false
  const league = context.league
  return Boolean(league && typeof league === 'object' && Object.keys(league as object).length > 0)
}
