/**
 * The commissioner review a screen has shown for each trade, by trade id — so the approve / veto
 * buttons can send the `reviewId` it rested on, and the decision is logged with it (design step 6:
 * "trade proposed → review generated → commissioner decides → decision logged").
 *
 * Client-side, per page load. A null id means the review was shown but its receipt was not saved
 * (the receipts migration not yet applied); the decision still goes through.
 */
const shown = new Map<string, string | null>()

export function rememberReviewId(tradeId: string, reviewId: string | null): void {
  shown.set(tradeId, reviewId)
}

export function reviewIdFor(tradeId: string): string | null {
  return shown.get(tradeId) ?? null
}
