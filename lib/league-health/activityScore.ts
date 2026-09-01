/**
 * The one activity formula (6.1).
 *
 * ── 🛑 THERE USED TO BE TWO, AND THEY DISAGREED BY 10 POINTS ON AN EMPTY LEAGUE ─────────────
 * `league-health-engine` and `commissioner-assistant-engine` each had a private `computeEngagement`
 * with different constants and different inputs:
 *
 *   league-health   base 30 + min(20, trades×6)  + min(20, claims×2.5) + min(15, chat×0.3)
 *                            + 15 (lineup ≥ .95) or 8 (≥ .8)
 *   assistant       base 40 + min(25, trades×8)  + min(25, claims×3)   + 10 if none inactive
 *
 * Both were labelled "engagement", both were 0–100, and neither could report a dead league as
 * dead. This is the collapse §6.1 asked for: one implementation, two callers.
 *
 * ── ⚠ WHY IT IS NOT SIMPLY THE LEAGUE-HEALTH FORMULA ────────────────────────────────────────
 * The assistant has no chat count and no lineup submission rate. Calling league-health's formula
 * directly would cap it at 30+20+20 = **70** for inputs that previously reached 100 — and its own
 * thresholds are `>= 60` for "good engagement" and `< 40` for "low", so a 70 ceiling makes "good"
 * materially harder to reach. That is a silent regression on a live route, not a collapse.
 *
 * So an unavailable term is **excluded from the denominator** rather than scored as zero: the
 * result is normalised against the maximum actually achievable from the inputs supplied. A caller
 * with every input sees byte-identical numbers to before; a caller with fewer sees the same 0–100
 * range over its own terms.
 *
 * 🛑 ABSENT IS NOT ZERO. `chatMessages: 0` means "we looked and there were none" and scores 0 out
 * of 15. `chatMessages: null` means "this caller cannot know", and the 15 leaves the denominator
 * entirely. Collapsing those two would punish a surface for a field it was never given — the same
 * distinction the grounding packet draws between a gap and a zero.
 */

/** Clamp helper, local so this file depends on nothing. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export interface ActivityScoreInput {
  /** Managers still playing, over total. Drives the base — see below. */
  activeManagers: number
  numTeams: number
  totalTrades: number
  totalWaiverClaims: number
  /** Null when the caller has no chat signal at all. NOT the same as 0. */
  chatMessageCount?: number | null
  /** 0–1. Null when the caller has no lineup signal at all. NOT the same as 0. */
  lineupSubmissionRate?: number | null
}

/** The weights, named so the normalisation below cannot drift from them. */
const W_BASE = 30
const W_TRADES = 20
const W_CLAIMS = 20
const W_CHAT = 15
const W_LINEUP = 15

/**
 * 0–100 activity, normalised over the terms the caller can actually supply.
 *
 * ⚠ THE BASE IS EARNED BY PARTICIPATION, NOT GRANTED. It scales by active-manager share, so a
 * league nobody is left in scores 0 rather than the 30 (or 40) the old formulas floored at. Every
 * other term is non-negative, which is exactly why an unconditional base was a floor.
 */
export function computeActivityScore(input: ActivityScoreInput): number {
  const teams = Math.max(input.numTeams, 1)
  const activeShare = clamp(input.activeManagers / teams, 0, 1)

  let earned = W_BASE * activeShare
  let available = W_BASE

  earned += Math.min(W_TRADES, (input.totalTrades / teams) * 6)
  available += W_TRADES

  earned += Math.min(W_CLAIMS, (input.totalWaiverClaims / teams) * 2.5)
  available += W_CLAIMS

  if (input.chatMessageCount != null) {
    earned += Math.min(W_CHAT, input.chatMessageCount * 0.3)
    available += W_CHAT
  }

  if (input.lineupSubmissionRate != null) {
    earned += input.lineupSubmissionRate >= 0.95 ? W_LINEUP : input.lineupSubmissionRate >= 0.8 ? 8 : 0
    available += W_LINEUP
  }

  // Normalise to the achievable maximum. `available` can never be 0 — the base and the two
  // transaction terms are unconditional — so this cannot divide by zero.
  return clamp(Math.round((earned / available) * 100), 0, 100)
}
