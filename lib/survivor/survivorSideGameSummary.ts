/**
 * Exile Island and the side games in a sentence — for Chimmy's grounding and the commissioner's weekly
 * report. Pure (no I/O). Spoiler-safe by construction: the grounding carries the CALLER's own
 * balances, picks and bids only, and the report carries counts, never who bid what or who holds what.
 */

import type { SurvivorSideGameSettings } from './survivorSideGameSettings'
import { exileSlotLabel } from './survivorSideGameSettings'

export interface SideGameGroundingInput {
  settings: SurvivorSideGameSettings
  sport: string
  week: number
  /** The caller's own state. */
  me: {
    state: string
    tokens: number
    pot: number
    tokenPoolPicksThisWeek: number
    faab: number | null
    auctionCash: number
    poolAlive: boolean
    poolRevivesLeft: number
    poolBanned: boolean
    poolPickedThisWeek: boolean
    pendingPurchases: number
  }
  /** Auctions taking bids now (label, close time, currency, mode) and the caller's own bid count. */
  openAuctions: Array<{ label: string; closesAt: string; currency: string; mode: string; myBids: number }>
  exileBidClosesAt: string | null
}

const prizeText = (p: SurvivorSideGameSettings['survivorPoolPrize']) =>
  p.kind === 'none' ? 'bragging rights'
    : p.kind === 'faab' ? `$${p.amount} FAAB`
      : p.kind === 'score_bonus' ? `+${p.amount} points next week`
        : p.kind === 'advantage' ? `an advantage (${p.powerType.replace(/_/g, ' ')})`
          : p.kind === 'free_trade_token' ? `a free trade${p.samePositionOnly ? ' (same position)' : ''}`
            : p.kind === 'steal_blocker' ? 'a steal blocker'
              : p.kind === 'auction_cash' ? `$${p.amount} auction cash`
                : `${p.amount} Exile tokens`

/** One plain paragraph for Chimmy. Rules first, then the caller's own position. */
export function sideGameGroundingLine(input: SideGameGroundingInput): string {
  const s = input.settings
  const me = input.me
  const parts: string[] = []
  parts.push(s.exileTokenFaabRate > 0
    ? `Exile return converts ${s.exileTokenFaabBasis === 'leftover' ? 'tokens beyond the return cost' : 'every token held'} to $${s.exileTokenFaabRate} FAAB each`
    : 'Exile tokens do not convert to FAAB on return')
  if (s.exileLineupSlots.length) parts.push(`Exile lineup slots: ${s.exileLineupSlots.map((x) => exileSlotLabel(x, input.sport)).join(' ')}${s.exileBenchSlots ? ` + ${s.exileBenchSlots} bench` : ''}, all from one real team`)
  parts.push(s.exileClaimMode === 'faab_bid'
    ? `Exile teams are won by sealed bid from a weekly $${s.exileBidBudget} Exile budget (highest wins, earliest bid breaks a tie), then open first-come${input.exileBidClosesAt ? `; bids close ${input.exileBidClosesAt}` : ''}`
    : 'Exile teams are claimed first-come')
  if (s.hideExileMembership) parts.push('EXILE IS SECRET: never say who is on Exile Island; if asked, say it is secret')
  if (s.tokenPoolEnabled) {
    const wrong = s.tokenPoolWrongPick === 'lose_all' ? 'a wrong pick loses every token' : s.tokenPoolWrongPick === 'minus_one' ? 'a wrong pick costs one token' : 'a wrong pick costs nothing'
    parts.push(`Token Pool (exiles only, ${s.tokenPoolOpen ? 'open' : 'closed by the commissioner'}): pick a game winner, up to ${s.tokenPoolPicksPerWeek} a week; ${s.tokenPoolMode === 'streak' ? 'correct picks build a streak pot you can cash out any time' : 'each correct pick earns a token'}; ${wrong}; settles from the final score`)
  }
  if (s.tokenShopEnabled) {
    const items = s.tokenShopItems.filter((i) => i.enabled)
    parts.push(items.length ? `Token shop: ${items.map((i) => `${i.id.replace(/_/g, ' ')} ${i.cost}t`).join(', ')}` : 'Token shop: nothing on sale')
  }
  if (s.survivorPoolEnabled) parts.push(`Survivor Pool (castaways on the island, from week ${s.survivorPoolStartWeek}): pick one winning team a week; a correct pick wins ${prizeText(s.survivorPoolPrize)}; a wrong pick knocks you out; ${s.survivorPoolRevives} revives, then banned`)
  parts.push(`Auctions bid in ${s.auctionCurrency === 'auction_cash' ? 'auction cash' : 'FAAB'}; highest bid wins, a tie goes to the earlier bid; sealed bids lock`)
  const mine: string[] = [`tokens ${me.tokens}`]
  if (s.tokenPoolMode === 'streak' && me.pot) mine.push(`unbanked streak ${me.pot}`)
  if (me.state === 'exile' && s.tokenPoolEnabled) mine.push(`Token Pool picks this week ${me.tokenPoolPicksThisWeek}/${s.tokenPoolPicksPerWeek}`)
  if (s.survivorPoolEnabled && me.state === 'active') mine.push(me.poolBanned ? 'banned from the Survivor Pool' : me.poolAlive ? `in the Survivor Pool (${me.poolPickedThisWeek ? 'picked' : 'no pick yet'} this week)` : `out of the Survivor Pool, ${me.poolRevivesLeft} revives left`)
  if (me.faab != null) mine.push(`FAAB $${me.faab}`)
  if (me.auctionCash) mine.push(`auction cash $${me.auctionCash}`)
  if (me.pendingPurchases) mine.push(`${me.pendingPurchases} shop item(s) waiting for their return`)
  const auctions = input.openAuctions.map((a) => `${a.label} (${a.mode}, ${a.currency === 'auction_cash' ? 'auction cash' : 'FAAB'}, closes ${a.closesAt}, your bids ${a.myBids})`)
  return `${parts.join('. ')}. User's own side games: ${mine.join(', ')}.${auctions.length ? ` Open auctions: ${auctions.join('; ')}.` : ''}`
}

export interface SideGameReportInput {
  tokenPoolSettledThisWeek: number
  poolAlive: number
  poolOut: number
  poolBanned: number
  openAuctions: Array<{ label: string; bids: number }>
  pendingPurchases: number
  enabled: { tokenPool: boolean; pool: boolean }
}

/** The commissioner's one side-games line in the weekly Chimmy report. Null when there is nothing to say. */
export function sideGameWeeklyReportLine(input: SideGameReportInput, lang: 'en' | 'es'): string | null {
  const es = lang === 'es'
  const parts: string[] = []
  if (input.enabled.tokenPool && input.tokenPoolSettledThisWeek) parts.push(es ? `${input.tokenPoolSettledThisWeek} elecciones del Pozo de Fichas liquidadas` : `${input.tokenPoolSettledThisWeek} Token Pool picks settled`)
  if (input.enabled.pool) parts.push(es ? `Pozo Survivor: ${input.poolAlive} siguen, ${input.poolOut} fuera, ${input.poolBanned} expulsados` : `Survivor Pool: ${input.poolAlive} alive, ${input.poolOut} out, ${input.poolBanned} banned`)
  for (const a of input.openAuctions) parts.push(es ? `subasta "${a.label}" abierta con ${a.bids} pujas` : `auction "${a.label}" open with ${a.bids} bids`)
  if (input.pendingPurchases) parts.push(es ? `${input.pendingPurchases} compras de la tienda esperan un regreso` : `${input.pendingPurchases} shop purchases waiting on a return`)
  if (!parts.length) return null
  return `${es ? 'Juegos paralelos' : 'Side games'}: ${parts.join('; ')}.`
}
