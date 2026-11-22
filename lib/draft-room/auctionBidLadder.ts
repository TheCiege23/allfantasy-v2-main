/**
 * Auction bid history — the shapes and pure helpers shared by the server log
 * (lib/live-draft-engine/auction/auctionBidLog.ts) and the draft room's ladder
 * (components/app/draft-room/AuctionBidLadder.tsx). No server imports here.
 */

/** One accepted bid, as the room receives it. `createdAt` is an ISO string. */
export type AuctionBidRow = {
  id: string
  playerKey: string
  playerName: string
  rosterId: string
  amount: number
  createdAt: string
}

/**
 * The key a bid is filed under, so the player on the block and the pick that sold him find the same
 * rungs. The player id when there is one (the nomination carries it onto the pick at resolve), else the
 * normalized name — the room's own nominate button sends only a name.
 *
 * ⚠ A player passed unsold and nominated again later in the same draft shares one key, so his ladder
 * shows both rounds of bidding. Nothing in the auction state numbers nominations; this is the honest
 * limit of keying on the player.
 */
export function auctionBidPlayerKey(player: { playerId?: string | null; playerName?: string | null }): string {
  const id = player.playerId?.trim()
  if (id) return `id:${id}`
  return `name:${(player.playerName ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`
}

/** One player's bids, newest first. Ties on time fall back to the higher amount (the later bid). */
export function ladderFor(bids: readonly AuctionBidRow[], playerKey: string): AuctionBidRow[] {
  return bids
    .filter((b) => b.playerKey === playerKey)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.amount - a.amount)
}
