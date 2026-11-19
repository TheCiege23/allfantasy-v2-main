import { getAuctionMaxBid } from '@/lib/mock-draft/draft-engine'
import type { DraftPlayerRankingRow } from './RecommendationEngine'

/**
 * Auction draft advice, built on the ONE draft engine's ranking (2026-11-14).
 *
 * The engine already knew a team's affordability (Phase 30) but never named a price, and the
 * Decision OS draft decision answered auctions with 409 `auction_unsupported`. This turns the
 * engine's ranking into dollars for THIS room:
 *
 *   MARKET PRICE — what the room is likely to pay. The money still spendable above minimum bids
 *   (every team's budget minus a minimum bid for each open slot) is shared across the players the
 *   room still has to buy, steeply weighted toward the top of the market (ADP) order:
 *   weight = (N + 1 − rank)^3.5, N = open slots in the room. A twelve-team, $200 start puts the top
 *   player near $55 and the 90th near $6, which is the familiar shape of a real auction.
 *
 *   YOUR PRICE — the market price moved by what the engine knows about YOUR roster and this draft:
 *   need at the position, and the context score (a bye inside a tournament stage's scoring window
 *   costs value; a run or the teams ahead add urgency). Capped by your legal maximum bid.
 *
 * Nothing here is a fabricated market fact: there is no average-auction-value table in the database,
 * so "market price" is a model of THIS room's remaining money, and the advice says so.
 *
 * PURE. Callers pass the ranking and the room's budgets.
 */

export type AuctionTeamBudget = {
  /** Remaining budget. */
  budget: number
  /** Roster spots still to fill. */
  openSlots: number
}

export type AuctionRoom = {
  teams: readonly AuctionTeamBudget[]
  minBid: number
}

export type AuctionPrice = {
  playerName: string
  position: string
  team: string | null
  marketPrice: number
  yourPrice: number
  /** yourPrice − marketPrice: positive = worth more to you than to the room. */
  surplus: number
  reason: string
}

export type AuctionAdvice = {
  /** Your legal maximum bid right now (budget minus a minimum bid for every other open slot). */
  maxLegalBid: number
  /** Your dollars per open slot against the room's average — over 1 means you can outbid. */
  budgetEdge: number | null
  /** The player up for bid, priced, when there is one. */
  nominated: (AuctionPrice & { currentBid: number | null; verdict: 'bid' | 'let_go' | 'cannot_afford'; bidUpTo: number }) | null
  /** Best value targets: the largest surplus among players you can afford. */
  targets: AuctionPrice[]
  /** A player to nominate: high market price, low need for you — others spend, you do not. */
  nominate: AuctionPrice | null
  summary: string
  caveats: string[]
}

const MARKET_EXPONENT = 3.5

function round$(n: number): number {
  return Math.max(0, Math.round(n))
}

/**
 * Market prices for the players still in the pool, in the room's remaining money. `marketOrder` is
 * the pool in market (ADP) order, best first. Players past the room's open slots get the minimum.
 */
export function marketPrices(marketOrder: readonly { name: string }[], room: AuctionRoom): Map<string, number> {
  const minBid = Math.max(0, room.minBid)
  const openSlots = room.teams.reduce((n, t) => n + Math.max(0, t.openSlots), 0)
  const spendable = room.teams.reduce((n, t) => n + Math.max(0, t.budget - minBid * Math.max(0, t.openSlots)), 0)
  const out = new Map<string, number>()
  const n = Math.max(1, openSlots)
  let total = 0
  const weights = marketOrder.map((_, i) => {
    const w = i < n ? Math.pow(n - i, MARKET_EXPONENT) : 0
    total += w
    return w
  })
  marketOrder.forEach((p, i) => {
    const share = total > 0 ? weights[i]! / total : 0
    out.set(p.name, minBid + spendable * share)
  })
  return out
}

function yourFactor(row: DraftPlayerRankingRow): number {
  // Need 50 is neutral; a full starting hole (88+) is worth ~+20%, a filled position ~-20%.
  const needPart = (row.needScore - 50) / 190
  // The context score is in ranking points; ~30 points (a bye in half a two-week stage) ≈ -30%.
  const contextPart = row.contextScore / 100
  return Math.min(1.35, Math.max(0.4, 1 + needPart + contextPart))
}

function reasonFor(row: DraftPlayerRankingRow): string {
  const parts: string[] = []
  if (row.needScore >= 70) parts.push(`fills an open ${row.player.position} starter`)
  else if (row.needScore <= 20) parts.push(`${row.player.position} already covered`)
  if (row.byeStatus === 'in_window') parts.push(`bye (week ${row.byeWeek}) inside the scoring window`)
  if (row.byeStatus === 'played') parts.push('bye already played')
  if (row.contextScore > 2 && row.byeStatus !== 'played') parts.push('position is being drained')
  return parts.length ? parts.join('; ') : 'priced at market for your roster'
}

export function buildAuctionAdvice(args: {
  /** The engine's ranking for YOUR roster (computeDraftPlayerRankings(...).scored). */
  ranked: readonly DraftPlayerRankingRow[]
  room: AuctionRoom
  me: AuctionTeamBudget
  nomination?: { playerName: string; currentBid: number | null } | null
  /** True when the room's budgets were not supplied and defaults were assumed. */
  budgetsAssumed?: boolean
}): AuctionAdvice {
  const { ranked, room, me } = args
  const caveats: string[] = []
  if (args.budgetsAssumed) caveats.push('Team budgets were not available, so every team was assumed to have the default budget.')
  caveats.push('Prices are modelled from the money left in this room and the market order — there is no average-auction-value feed.')

  const maxLegalBid = me.openSlots > 0 ? getAuctionMaxBid({ budget: me.budget, rosterSlotsRemaining: me.openSlots, minimumBid: room.minBid }) : 0
  const perSlot = (t: AuctionTeamBudget) => (t.openSlots > 0 ? t.budget / t.openSlots : 0)
  const others = room.teams.filter((t) => t.openSlots > 0)
  const avgPerSlot = others.length ? others.reduce((n, t) => n + perSlot(t), 0) / others.length : 0
  const budgetEdge = avgPerSlot > 0 && me.openSlots > 0 ? Math.round((perSlot(me) / avgPerSlot) * 100) / 100 : null

  const marketOrder = [...ranked].sort((a, b) => a.adp - b.adp).map((r) => ({ name: r.player.name }))
  const market = marketPrices(marketOrder, room)
  const priced: AuctionPrice[] = ranked.map((row) => {
    const marketPrice = round$(market.get(row.player.name) ?? room.minBid)
    const yourPrice = Math.min(maxLegalBid, round$((market.get(row.player.name) ?? room.minBid) * yourFactor(row)))
    return {
      playerName: row.player.name,
      position: row.player.position,
      team: row.player.team ?? null,
      marketPrice,
      yourPrice,
      surplus: yourPrice - marketPrice,
      reason: reasonFor(row),
    }
  })
  const byName = new Map(priced.map((p) => [p.playerName, p]))

  let nominated: AuctionAdvice['nominated'] = null
  if (args.nomination) {
    const p = byName.get(args.nomination.playerName)
    if (p) {
      const currentBid = args.nomination.currentBid
      const bidUpTo = Math.min(maxLegalBid, p.yourPrice)
      const verdict: 'bid' | 'let_go' | 'cannot_afford' =
        maxLegalBid <= (currentBid ?? 0) ? 'cannot_afford' : (currentBid ?? 0) < bidUpTo ? 'bid' : 'let_go'
      nominated = { ...p, currentBid, verdict, bidUpTo }
    } else {
      caveats.push(`${args.nomination.playerName} is not in the ranked pool, so no price could be modelled.`)
    }
  }

  const targets = priced
    .filter((p) => p.yourPrice > room.minBid && p.marketPrice <= maxLegalBid)
    .sort((a, b) => b.surplus - a.surplus || b.yourPrice - a.yourPrice)
    .slice(0, 5)

  // Nominate a player the room wants more than you do: high market price, lowest surplus for you.
  const nominate =
    priced
      .filter((p) => p.marketPrice >= Math.max(room.minBid + 5, 10))
      .sort((a, b) => a.surplus - b.surplus || b.marketPrice - a.marketPrice)[0] ?? null

  const summary = nominated
    ? nominated.verdict === 'bid'
      ? `Bid on ${nominated.playerName} up to $${nominated.bidUpTo} (market ~$${nominated.marketPrice}).`
      : nominated.verdict === 'let_go'
        ? `Let ${nominated.playerName} go above $${nominated.bidUpTo} — your price is below the bid (market ~$${nominated.marketPrice}).`
        : `You cannot outbid on ${nominated.playerName}: your maximum legal bid is $${maxLegalBid}.`
    : targets[0]
      ? `Best value for you: ${targets[0].playerName} — worth ~$${targets[0].yourPrice} to you vs ~$${targets[0].marketPrice} at market.`
      : `Your maximum legal bid is $${maxLegalBid}.`

  return { maxLegalBid, budgetEdge, nominated, targets, nominate, summary, caveats }
}
