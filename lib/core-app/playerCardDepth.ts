/**
 * The player card's share of the /core player-depth paywall (./coreDepthAccess.ts).
 *
 * Free on the card: who he is, his price and ranks, ownership, the schedule (playoff weeks
 * included — fixtures are public), his injury and the news. That is the reference card.
 *
 * AF Pro: the MARKET AND HISTORY — how his price has moved, the trades that moved him (the
 * imported pool and this league's), the players priced beside him, and the insight line, which
 * is arithmetic over the price move and those comparisons and would hand them straight back.
 *
 * ⚠ WITHHELD HERE, IN THE ROUTE, NOT HIDDEN IN THE SHEET. The sheet is a client component: a
 * field it was sent is a field anyone can read in the network tab.
 *
 * ⚠ AND `depth` TRAVELS WITH THE CARD, because an emptied section reads as a claim otherwise —
 * `league.trades: []` renders "No trade in this league has moved him", which would be false.
 */
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'
import type { PlayerCardData } from '@/lib/core-app/playerCard'

export function applyPlayerCardDepth(card: PlayerCardData, access: CoreDepthAccess): PlayerCardData {
  if (access.unlocked) return { ...card, depth: access }
  const locked = (what: string) => ({
    available: false as const,
    reason: `${what} ${what.endsWith('s') ? 'are' : 'is'} part of ${access.planName}.`,
  })
  return {
    ...card,
    market: card.market.available
      ? { available: true as const, data: { ...card.market.data, delta: null } }
      : card.market,
    trades: locked('Trade history'),
    comps: locked('Similar-price players'),
    insight: null,
    league: card.league ? { ...card.league, trades: [] } : null,
    depth: access,
  }
}
