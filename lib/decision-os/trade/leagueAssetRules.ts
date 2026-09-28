/**
 * Which assets the one grade may price in a league, and how a devy prospect is priced — Phase 9.
 *
 * PURE. The loader (`./leagueAssetPolicy.ts`) reads the league's held devy rights; this module decides.
 *
 * Guap's decisions (2026-09-27):
 *   - Draft picks are REFUSED where nothing prices them honestly: in a redraft league (the design's
 *     rule — no next season to use them in), in any sport but the NFL (the pick data is the NFL's),
 *     and for a draft that has already been held (that pick is a player now). NFL dynasty picks are
 *     priced as before. College leagues keep their own refusal (`./ncaafRedraftValue.ts`).
 *   - A college player held in an NFL devy or C2C league is priced by `devyOptionValue` —
 *     P(drafted) × expected dynasty value on arrival × a discount for the wait — which is already on
 *     the FantasyCalc dynasty board, so he sits on the same scale as the NFL players beside him. No
 *     campus/canton weight, and the commissioner's bridge rate is not used.
 */

import type { PricedAsset } from '@/lib/hybrid-valuation'
import { devyOptionValue, type DevyOptionValueArgs } from '@/lib/devy/devyOptionValue'
import { playerNamesAgree } from '@/lib/player-identity/externalIdNamespace'
import type { TradeAssetInput, TradeConsolePlayerLine } from '@/lib/trade-value-console/types'

export const REDRAFT_PICKS_REASON =
  'Draft picks are not part of a redraft league — there is no next season for them to be used in — so a deal carrying one is not graded.'

/** A host status that says this season is under way or over — so its draft has been held. */
const POST_DRAFT_STATUSES = new Set(['in_season', 'post_season', 'complete', 'completed'])

/**
 * Why a deal's picks cannot be priced in this league, or null. Refuses only on EVIDENCE: a pick for a
 * season before the league's, or for the league's own season once the host says that season is under
 * way. A league whose status says nothing keeps its current-season picks priced — not knowing is not
 * proof the draft happened.
 */
export function pickPolicyRefusal(args: {
  sport: string | null | undefined
  leagueType: string | null | undefined
  leagueSeason?: number | null
  leagueStatus?: string | null
  assets: readonly TradeAssetInput[]
}): string | null {
  const picks = args.assets.filter((a): a is Extract<TradeAssetInput, { kind: 'pick' }> => a.kind === 'pick')
  if (picks.length === 0) return null
  const sport = String(args.sport ?? '').trim().toUpperCase()
  // College leagues carry their own refusal, with its own reasons.
  if (sport === 'NCAAF') return null
  if (sport !== 'NFL') {
    return `Draft picks have no ${sport || 'league'} price yet — the pick data on file is the NFL’s — so a deal carrying one is not graded.`
  }
  if (String(args.leagueType ?? '').trim().toLowerCase() === 'redraft') return REDRAFT_PICKS_REASON

  const season = args.leagueSeason
  if (season == null || !Number.isFinite(season)) return null
  const seasonUnderWay = POST_DRAFT_STATUSES.has(String(args.leagueStatus ?? '').trim().toLowerCase())
  const used = picks.find((p) => p.year < season || (p.year === season && seasonUnderWay))
  if (!used) return null
  return `The ${used.year} draft has already been held, so that pick is a player now. Trade the player drafted with it — this deal is not graded as it stands.`
}

/** A college player this league holds devy rights on, with what `devyOptionValue` reads. */
export type HeldDevyPlayer = {
  devyPlayerId: string
  name: string
  position: string | null
  ppaSeasonTotal: number | null
  recruitingComposite: number | null
  recruitingStars: number | null
  draftEligibleYear: number | null
}

/** One held prospect, by id or by a name no other held prospect shares — or none. */
export function matchHeldDevy(
  asset: { rosterPlayerId?: string; playerId?: string; name?: string } | undefined,
  lineName: string,
  held: readonly HeldDevyPlayer[],
): HeldDevyPlayer | null {
  for (const id of [asset?.rosterPlayerId, asset?.playerId]) {
    const key = String(id ?? '').trim()
    if (!key) continue
    const byId = held.find((h) => h.devyPlayerId === key)
    if (byId) return byId
  }
  const name = String(asset?.name ?? lineName ?? '').trim()
  if (!name) return null
  const matches = held.filter((h) => playerNamesAgree(h.name, name))
  return matches.length === 1 ? matches[0]! : null
}

export const DEVY_BASIS_NOTE =
  'College prospects are priced as options on an NFL career — the chance a player like him is drafted, times the dynasty value such a player carries on arrival, discounted for the wait — on the FantasyCalc Superflex 12-team board.'

function devyPricedAsset(name: string, position: string | null, value: number): PricedAsset {
  return {
    name,
    type: 'player',
    value,
    // Only the market value is graded; the other components are not measured for a prospect.
    assetValue: { marketValue: value, impactValue: 0, vorpValue: 0, volatility: 0 },
    ...(position ? { position } : {}),
    source: 'devy-option',
  }
}

/**
 * The same rule for a caller that holds `PricedAsset`s rather than console lines — the trade evaluator's
 * first pricing pass (2026-09-28). That pass refused every college player (DEVY_SCALE) before the one
 * grade, which prices held prospects through `applyDevyPricing` below, ever ran — so a devy league's
 * trade was refused on the page while its grade would have been taken. Pricing both passes with one
 * matcher and one `devyOptionValue` is what keeps the page's totals and the letter on the same number.
 *
 * Only an UNPRICED player is touched; a prospect this league does not hold, or one `devyOptionValue`
 * cannot measure, stays unpriced (the route then refuses as before). Null is never zero.
 */
export function priceHeldDevyAssets(args: {
  prices: readonly PricedAsset[]
  held: readonly HeldDevyPlayer[]
  currentSeason: number
}): { prices: PricedAsset[]; devyPriced: string[]; unmeasured: string[] } {
  const prices = [...args.prices]
  const devyPriced: string[] = []
  const unmeasured: string[] = []
  prices.forEach((p, i) => {
    if (!p.unpriced || p.type === 'pick') return
    const held = matchHeldDevy(undefined, p.name, args.held)
    if (!held) return
    const option = devyOptionValue({
      name: held.name,
      position: held.position,
      ppaSeasonTotal: held.ppaSeasonTotal,
      recruitingComposite: held.recruitingComposite,
      recruitingStars: held.recruitingStars,
      draftEligibleYear: held.draftEligibleYear,
      currentSeason: args.currentSeason,
    } satisfies DevyOptionValueArgs)
    if (option.value == null) {
      unmeasured.push(option.basis)
      return
    }
    prices[i] = devyPricedAsset(held.name, held.position, option.value)
    devyPriced.push(held.name)
  })
  return { prices, devyPriced, unmeasured }
}

/**
 * Price every line the chart could not, when it is a college player this league holds. Returns new
 * arrays (index-aligned, as the grade requires) and what happened.
 *
 * A held prospect `devyOptionValue` cannot measure stays unpriced — its reason is kept, and the grade
 * withholds exactly as it would have. Null is never zero.
 */
export function applyDevyPricing(args: {
  inputs: readonly TradeAssetInput[]
  lines: readonly TradeConsolePlayerLine[]
  priced: readonly PricedAsset[]
  held: readonly HeldDevyPlayer[]
  currentSeason: number
}): { lines: TradeConsolePlayerLine[]; priced: PricedAsset[]; devyPriced: number; unmeasured: string[] } {
  const lines = [...args.lines]
  const priced = [...args.priced]
  let devyPriced = 0
  const unmeasured: string[] = []
  // Inputs line up with lines only when nothing was skipped; otherwise match by name alone.
  const aligned = args.inputs.length === args.lines.length
  lines.forEach((line, i) => {
    if (!line.unpriced || priced[i]?.type === 'pick') return
    const input = aligned ? args.inputs[i] : undefined
    const held = matchHeldDevy(input && input.kind === 'player' ? input : undefined, line.name, args.held)
    if (!held) return
    const option = devyOptionValue({
      name: held.name,
      position: held.position,
      ppaSeasonTotal: held.ppaSeasonTotal,
      recruitingComposite: held.recruitingComposite,
      recruitingStars: held.recruitingStars,
      draftEligibleYear: held.draftEligibleYear,
      currentSeason: args.currentSeason,
    } satisfies DevyOptionValueArgs)
    if (option.value == null) {
      unmeasured.push(option.basis)
      return
    }
    const pa = devyPricedAsset(held.name, held.position, option.value)
    priced[i] = pa
    const { unpriced: _u, unpricedReason: _r, ...rest } = line
    lines[i] = {
      ...rest,
      name: held.name,
      position: held.position ?? line.position,
      marketValue: option.value,
      dataSource: 'devy-option',
      pricedSource: 'unknown',
    }
    devyPriced += 1
  })
  return { lines, priced, devyPriced, unmeasured }
}
