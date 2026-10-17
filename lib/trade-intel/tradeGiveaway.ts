import type { GradedTrade, TradeSideGrade } from '@/lib/trade-intel/sleeperTradeGradeService'

/**
 * A two-team trade where one side received NOTHING — no player, no pick, no FAAB. PURE, so both the
 * grader (`completedTradeGrade.ts`, server-only) and the email renderer read the same answer.
 *
 * ⚠ ONLY ON A PAYLOAD THAT CARRIES FAAB. "No FAAB" is a claim, and a ledger cached before FAAB was
 * read (`faabIn` absent) cannot make it — that side may have been paid in FAAB we never loaded.
 */
export function giveawaySide(trade: GradedTrade): TradeSideGrade | null {
  if (trade.sides.length !== 2) return null
  return (
    trade.sides.find(
      (s) => s.playersIn.length === 0 && s.picksIn.length === 0 && typeof s.faabIn === 'number' && s.faabIn <= 0,
    ) ?? null
  )
}

/**
 * Why a giveaway is not graded — said as what Sleeper recorded, not as missing data. Zay Flowers for
 * nothing (Pirate League twinty, 2026 week 3) read "One side of this trade has no assets recorded",
 * which sounds like our gap rather than the league's giveaway.
 */
export function giveawayReason(trade: GradedTrade): string | null {
  const empty = giveawaySide(trade)
  if (!empty) return null
  return `${empty.managerName} received nothing in return — no player, pick or FAAB on Sleeper’s record — so there is no value gap to grade.`
}
