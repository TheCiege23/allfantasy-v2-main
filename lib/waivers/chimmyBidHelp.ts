/**
 * Chimmy bid help (AF Pro, owner 2026-11-26): a suggested FAAB range for a claim, read from how THIS
 * league has actually bid. Pure. The route (app/api/waiver-wire/leagues/[leagueId]/bid-help) supplies
 * the league's past winning bids and the manager's remaining budget, and gates on AF Pro.
 *
 * No invented market: with fewer than five winning bids in the league there is nothing to read, and the
 * answer says so rather than guessing.
 */

export type BidHelp =
  | { ok: true; low: number; high: number; typical: number; sample: number; note: string }
  | { ok: false; note: string }

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[idx]!
}

export function suggestBidRange(input: { winningBids: number[]; remainingBudget: number; minBid?: number }): BidHelp {
  const bids = input.winningBids.filter((b) => Number.isFinite(b) && b > 0).sort((a, b) => a - b)
  if (bids.length < 5) {
    return { ok: false, note: 'Not enough bids in this league yet to suggest a range. Bid what the player is worth to you.' }
  }
  const floor = Math.max(input.minBid ?? 0, 1)
  const cap = Math.max(floor, Math.floor(input.remainingBudget))
  const clamp = (n: number) => Math.min(cap, Math.max(floor, Math.round(n)))
  const low = clamp(percentile(bids, 0.5))
  const high = clamp(percentile(bids, 0.8))
  const typical = clamp(percentile(bids, 0.65))
  const note =
    high >= cap
      ? `Winning bids here usually run $${low}–$${percentile(bids, 0.8)}; your $${cap} left caps it.`
      : `Winning bids in this league usually land between $${low} and $${high} (from ${bids.length} past wins).`
  return { ok: true, low, high, typical, sample: bids.length, note }
}
