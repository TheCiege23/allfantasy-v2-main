/**
 * Is the user TELLING us something, or THINKING OUT LOUD?
 *
 * 🛑 THE MEMORY PARSER COULD NOT TELL, AND WROTE BOTH DOWN THE SAME WAY. Any message
 * containing "trade" was filed into `past_trades` as history, and any message containing
 * "rebuild" set `teamArchetype = 'rebuilder'` outright. So "what if I traded Jefferson for
 * Chase?" became a trade that happened, and "should I rebuild?" became a decision the user
 * had made — from one sentence, with no confirmation.
 *
 * The brief is explicit (line 76): "Keep official rules, user preferences, hypothetical
 * scenarios and inferred behavior distinct. Explicit user direction overrides inferred
 * goals; proposed changes require confirmation." And acceptance scenario 11: "A hypothetical
 * trade does not persist as a completed trade or change the user's confirmed goals."
 *
 * Pure and synchronous on purpose — this decides what gets WRITTEN, so it must be testable
 * without a database.
 */

/** A question or a framed supposition is exploration, never a statement of fact. */
const EXPLORATORY_RE =
  /(^|\b)(what if|what about|should i|should we|would (?:you|it|that|i)|could i|do you think|thinking (?:of|about)|considering|hypothetical(?:ly)?|suppose|imagine|if i (?:were|was|trade|traded|drop|dropped|add|added)|worth it\b|\bvs\.?\b|or should)/i

/** Past-tense or settled language. Only these may be recorded as something that happened. */
const COMPLETED_TRADE_RE =
  /\b(i (?:just )?(?:traded|accepted|declined|rejected|completed|finalized)|we (?:traded|agreed|completed)|trade (?:went through|was accepted|is done|completed)|just (?:traded|accepted)|accepted (?:the|his|her|their) (?:trade|offer)|declined (?:the|his|her|their) (?:trade|offer))\b/i

/** Any trade-adjacent vocabulary at all — the old trigger, kept as the outer gate. */
/*
 * ⚠ `trading` must be in here. The original trigger was /\btrade\b|offer|counter|accept|
 * decline/i, which matched neither "trading" nor "trades" — so "thinking about trading my
 * 1st" was not even recognised as trade vocabulary. That gap was harmless only by accident:
 * it failed toward not recording. Widened deliberately, with the exploratory test in front
 * of it doing the actual protecting.
 */
const TRADE_MENTION_RE =
  /\btrad(?:e|es|ed|ing)\b|\boffer(?:ed|s|ing)?\b|\bcounter(?:ed|s)?\b|\baccept(?:ed|ing)?\b|\bdeclin(?:e|es|ed|ing)\b/i

export type TradeMentionKind = 'completed' | 'explored' | 'none'

/**
 * `completed` is the ONLY kind that may be persisted as trade history.
 *
 * ⚠ Exploration wins ties. "Should I have accepted that trade?" contains completed-looking
 * words and is still a question; recording it as history would be the exact bug. When in
 * doubt we record nothing, because a missing memory is recoverable and a fabricated one is
 * not.
 */
export function classifyTradeMention(message: string): TradeMentionKind {
  const text = typeof message === 'string' ? message : ''
  if (!TRADE_MENTION_RE.test(text)) return 'none'
  if (EXPLORATORY_RE.test(text)) return 'explored'
  if (COMPLETED_TRADE_RE.test(text)) return 'completed'
  return 'explored'
}

export type DirectionStance = 'declared' | 'explored'
export type TeamDirection = 'contender' | 'rebuilder'

const CONTENDER_RE = /\bcontend(?:er|ing)?\b|win[-\s]?now|playoff push|all-?in\b/i
const REBUILD_RE = /\brebuild(?:ing)?\b|tank(?:ing)?\b|future assets|retool\b/i

/**
 * A direction signal plus whether the user DECLARED it or was exploring it.
 *
 * Only `declared` may change a stored goal: that is the brief's "explicit user direction
 * overrides inferred goals". A question is not direction, however many keywords it contains.
 */
export function classifyDirectionSignal(message: string): {
  direction: TeamDirection | null
  stance: DirectionStance
} {
  const text = typeof message === 'string' ? message : ''
  const direction = CONTENDER_RE.test(text) ? 'contender' : REBUILD_RE.test(text) ? 'rebuilder' : null
  const stance: DirectionStance = EXPLORATORY_RE.test(text) ? 'explored' : 'declared'
  return { direction, stance }
}
