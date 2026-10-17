/**
 * WHAT THE /af-legacy "TRADE BREAKDOWN" CARD LISTS. PURE.
 *
 * The card sits under the trade result and shows the assets each side of the graded deal moves. Until
 * 2026-09-30 it read the dead inline evaluator's text boxes (`inlineSideA` / `inlineSideB`), which
 * nothing ever filled — so a Trade Hub result showed its values beside two EMPTY asset lists. The card
 * now shows the assets of the request that produced the result, captured when that request is sent.
 *
 * Orientation follows `lib/legacy/tradeHubDirection.ts`: the analyzer's `sideAValue` is what Team A
 * (the user) RECEIVES, so the "You Get" list is `assetsA` = the partner's picks, and "You Give" is
 * `assetsB` = the user's own. Deriving both from `tradeHubAnalyzeSides` keeps the lists and the values
 * beside them from ever pointing opposite ways.
 */
import { tradeHubAnalyzeSides, type TradeHubSides } from './tradeHubDirection'

/** An asset as the Trade Hub builds it for the analyzer (`buildSide` on the page). */
export type TradeBreakdownAsset = {
  type?: string
  player?: { name?: string | null } | null
  pick?: { year?: number | string | null; season?: number | string | null; round?: number | string | null; pickNumber?: number | null } | null
  faab?: { amount?: number | null } | null
  amount?: number | null
}

export type TradeBreakdown = { youGet: string[]; youGive: string[] }

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th']

/**
 * A short label for one asset: the player's name, "2027 1st.04" for a pick, "$25 FAAB".
 *
 * The page's previous labeller read `pick.season` and a top-level `amount`, but the Trade Hub builds
 * picks with `pick.year` and FAAB as `faab.amount` — so every pick and every FAAB amount it labelled
 * (the share card's asset list, the Decision Guardian's) read "Unknown asset". Both spellings are read.
 */
export function tradeAssetLabel(item: TradeBreakdownAsset | null | undefined): string {
  const name = item?.player?.name
  if (name) return String(name)
  const pick = item?.pick
  const year = pick?.year ?? pick?.season
  const round = Number(pick?.round)
  if (pick && year != null && year !== '' && Number.isFinite(round) && round >= 1) {
    const ord = ORDINAL[round - 1] ?? `${round}th`
    const slot = pick.pickNumber ? `.${String(pick.pickNumber).padStart(2, '0')}` : ''
    return `${year} ${ord}${slot}`
  }
  const amount = item?.faab?.amount ?? item?.amount
  if (amount != null && Number.isFinite(Number(amount))) return `$${amount} FAAB`
  return 'Unknown asset'
}

/** The card's two lists for a Trade Hub request: `mine` from the user's roster, `partner` from theirs. */
export function tradeHubBreakdown(sides: TradeHubSides<ReadonlyArray<TradeBreakdownAsset>>): TradeBreakdown {
  const { assetsA, assetsB } = tradeHubAnalyzeSides(sides)
  return { youGet: assetsA.map(tradeAssetLabel), youGive: assetsB.map(tradeAssetLabel) }
}
