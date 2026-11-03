/**
 * What a "find me a trade" message asks the trade finder for, read off the user's words. Pure, so the
 * decision lane and its tests read the same rule without loading the finder's database reads.
 */

/**
 * What the user asked the search to optimise for. `win_now` means "make my lineup better THIS season",
 * which a dynasty chart cannot answer: it prices a 22-year-old's next five years above a veteran's next
 * eight weeks. So a win-now search also reads the league's REDRAFT chart and keeps only packages that
 * raise the current-season value of what the user holds (`tradeFinderGrounding.ts`).
 */
export type TradeFinderGoal = 'win_now'

/** "win now", "contend", "this season", "playoff push", "all in". Never a guess. */
export function readTradeFinderGoal(text: unknown): TradeFinderGoal | null {
  if (typeof text !== 'string') return null
  return /\bwin[\s-]*now\b|\bcontend(?:ing|er)?\b|\bthis\s+(?:season|year)\b|\bplayoff\s+push\b|\bgo(?:ing)?\s+all[\s-]+in\b/i.test(text)
    ? 'win_now'
    : null
}

/**
 * "using my draft picks", "my 1st", "a 2nd round pick": the user put their own picks on the table.
 * "pick up" is a waiver phrase, not a pick.
 */
export function mentionsDraftPicks(text: unknown): boolean {
  if (typeof text !== 'string') return false
  return /\b(?:draft\s+)?picks?\b(?!\s*up\b)|\b(?:1st|2nd|3rd|first|second|third)[\s-]+(?:round(?:er)?s?|picks?)\b|\bmy\s+(?:1st|2nd|3rd|firsts?|seconds?|thirds?)\b/i.test(
    text,
  )
}
