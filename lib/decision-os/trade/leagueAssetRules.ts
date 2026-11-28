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
import { FUTURE_DISCOUNT, pickSlotInRound } from './sportDynastyValue'

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

/** The first draft this league has not yet held — the same evidence `pickPolicyRefusal` reads. */
export function nextDraftYearFor(season: number, status: string | null | undefined): number {
  return POST_DRAFT_STATUSES.has(String(status ?? '').trim().toLowerCase()) ? season + 1 : season
}

/** A college player this league holds devy rights on, with what `devyOptionValue` reads. */
export type HeldDevyPlayer = {
  devyPlayerId: string
  name: string
  /** `DevyPlayer.sport`. Only NCAAF rows can price on this (NFL) board; absent reads as NCAAF (legacy callers). */
  sport?: string | null
  position: string | null
  ppaSeasonTotal: number | null
  recruitingComposite: number | null
  recruitingStars: number | null
  draftEligibleYear: number | null
}

/**
 * Whether a held row can be priced on the NFL devy board at all. A college basketball row is dropped BEFORE
 * matching, not merely refused after it: left in, an NCAAB "Ryan Williams" makes an NCAAF "Ryan Williams"
 * ambiguous by name, and the football prospect silently goes unpriced.
 */
export function onNflDevyBoard(held: Pick<HeldDevyPlayer, 'sport'>): boolean {
  return String(held.sport ?? 'NCAAF').trim().toUpperCase() === 'NCAAF'
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

/**
 * What one held prospect is worth in this league — the ONE call every devy price in the grade goes
 * through, and the one the per-league Devy tab (`lib/core-app/devyLeagueTab.ts`) shows. A second copy of
 * this argument mapping is how a tab and a letter end up quoting different numbers for the same player.
 * `value` is null when a factor is unmeasured; null is never zero.
 */
export function heldDevyOptionValue(held: HeldDevyPlayer, currentSeason: number) {
  return devyOptionValue({
    name: held.name,
    sport: held.sport ?? null,
    position: held.position,
    ppaSeasonTotal: held.ppaSeasonTotal,
    recruitingComposite: held.recruitingComposite,
    recruitingStars: held.recruitingStars,
    draftEligibleYear: held.draftEligibleYear,
    currentSeason,
  } satisfies DevyOptionValueArgs)
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
  const nflHeld = args.held.filter(onNflDevyBoard)
  prices.forEach((p, i) => {
    if (!p.unpriced || p.type === 'pick') return
    const held = matchHeldDevy(undefined, p.name, nflHeld)
    if (!held) return
    const option = heldDevyOptionValue(held, args.currentSeason)
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
  const nflHeld = args.held.filter(onNflDevyBoard)
  lines.forEach((line, i) => {
    if (!line.unpriced || priced[i]?.type === 'pick') return
    const input = aligned ? args.inputs[i] : undefined
    const held = matchHeldDevy(input && input.kind === 'player' ? input : undefined, line.name, nflHeld)
    if (!held) return
    const option = heldDevyOptionValue(held, args.currentSeason)
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

/*
 * ── DEVY-DRAFT PICKS, ON THE PROSPECTS' OWN SCALE (2026-11-28) ─────────────────────────────────────
 *
 * MEASURED: a native `devy_pick` reached the grade as a plain `{ year, round }` pick
 * (`gradeInputsFromNativeItems` / `tradeRecord` matched `type.includes('pick')` and dropped the type),
 * so a pick in a league's COLLEGE draft was priced as an NFL ROOKIE pick — off the chart's rookie rows —
 * beside prospects priced by `devyOptionValue`. Two different assets on one silently mixed scale.
 *
 * `devyOptionValue.ts` already records that the pick CURVE's units (a rookie first = 950) do not
 * reconcile with the board, and that no conversion has been measured. So no conversion is invented here.
 * A devy pick buys a prospect, and the honest price of "the Nth selection" is the option value of the Nth
 * prospect still available: the league's own undrafted pool (`DevyPlayer` rows no team here holds rights
 * on), each priced by the SAME `heldDevyOptionValue` call, ranked best first. Future drafts are
 * discounted by `FUTURE_DISCOUNT` per year, the rule the Combined-pick board already uses
 * (`combinedC2CDraftValue.ts`). An NFL rookie pick (no `pool`) is untouched: it stays on the chart's own
 * rookie rows, which are already FantasyCalc dynasty board units like the option value.
 *
 * ⚠ ONLY MEASURED PROSPECTS ARE ON THE BOARD. An unmeasured prospect is not worth zero, so he is left
 * off rather than ranked last — which means a slot past the measured pool is WITHHELD, never priced at
 * the bottom of it. The basis says how many measured prospects the board holds.
 */

/** The league's undrafted pool as a board: measured option values, best first. Null is never zero. */
export function devyPickBoard(pool: readonly HeldDevyPlayer[], currentSeason: number): number[] {
  return pool
    .map((p) => heldDevyOptionValue(p, currentSeason).value)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
    .sort((a, b) => b - a)
}

type DevyPick = Extract<TradeAssetInput, { kind: 'pick' }>

/** The expected option value of the prospect a devy pick selects, or why it cannot be priced. PURE. */
export function devyDraftPickValue(args: {
  pick: Pick<DevyPick, 'year' | 'round' | 'overall' | 'tier'>
  board: readonly number[]
  teams: number | null
  /** The first devy draft not yet held — the pool on file is the one it selects from. */
  nextDraftYear: number
}): { value: number; overall: number; basis: string } | { value: null; reason: string } {
  const { pick, board, teams, nextDraftYear } = args
  const label = `The ${pick.year} devy round-${pick.round} pick`
  if (teams == null || !Number.isInteger(teams) || teams < 2) {
    return { value: null, reason: `${label} cannot be placed: the league size is not on file, so neither is the prospect it takes.` }
  }
  if (!Number.isInteger(pick.year) || pick.year < nextDraftYear || !Number.isInteger(pick.round) || pick.round < 1) {
    return { value: null, reason: `${label} is not a future devy pick this league can still use.` }
  }
  const before = (pick.round - 1) * teams
  const overall = pick.overall ?? before + pickSlotInRound(pick.tier, teams) + 1
  if (!Number.isInteger(overall) || overall <= before || overall > before + teams) {
    return { value: null, reason: `${label}'s slot does not fall inside its round.` }
  }
  const quote = board[overall - 1]
  if (quote == null) {
    return {
      value: null,
      reason: `${label} selects about the #${overall} prospect, but only ${board.length} undrafted prospect${board.length === 1 ? ' is' : 's are'} measured on this league's devy board — it is withheld rather than priced at the bottom of it.`,
    }
  }
  const years = pick.year - nextDraftYear
  const value = Math.round(quote * FUTURE_DISCOUNT ** years)
  return {
    value,
    overall,
    basis: `A devy pick is priced as the prospect it selects: about the #${overall} of ${board.length} measured undrafted prospects in this league, option value ${Math.round(quote)}${years > 0 ? `, discounted ${years} year${years === 1 ? '' : 's'} at ${FUTURE_DISCOUNT} for the later draft` : ''} — ${value} on the same board as the prospects and players beside it.`,
  }
}

/**
 * Re-price every devy-draft pick in a side on the prospects' scale. Index-aligned like
 * `applyDevyPricing`; when inputs and lines are NOT aligned the devy pick cannot be located, so every pick
 * line is withheld rather than one being left on the rookie chart. A rookie pick (no `pool`) is untouched.
 */
export function applyDevyPickPricing(args: {
  inputs: readonly TradeAssetInput[]
  lines: readonly TradeConsolePlayerLine[]
  priced: readonly PricedAsset[]
  board: readonly number[]
  teams: number | null
  nextDraftYear: number
  /** When set, nothing can price a devy pick in this league — each one is withheld with this reason. */
  refusal?: string | null
}): { lines: TradeConsolePlayerLine[]; priced: PricedAsset[]; devyPicksPriced: number; refused: string[] } {
  const lines = [...args.lines]
  const priced = [...args.priced]
  const refused: string[] = []
  let devyPicksPriced = 0
  const isDevyPick = (a: TradeAssetInput | undefined): a is DevyPick => a?.kind === 'pick' && a.pool === 'devy'
  if (!args.inputs.some(isDevyPick)) return { lines, priced, devyPicksPriced, refused }

  const withhold = (i: number, reason: string) => {
    const line = lines[i]!
    const why = { code: 'no_pick_market' as const, label: reason }
    lines[i] = { ...line, unpriced: true, unpricedReason: why, dataSource: 'devy-pick' }
    const p = priced[i]
    if (p) priced[i] = { ...p, unpriced: true, unpricedReason: why }
    refused.push(reason)
  }

  if (args.inputs.length !== args.lines.length) {
    lines.forEach((_, i) => {
      if (priced[i]?.type === 'pick') withhold(i, 'A devy-draft pick could not be matched to its line, so no pick in this deal is priced on the wrong draft.')
    })
    return { lines, priced, devyPicksPriced, refused }
  }

  args.inputs.forEach((input, i) => {
    if (!isDevyPick(input)) return
    if (args.refusal) {
      withhold(i, args.refusal)
      return
    }
    const quote = devyDraftPickValue({ pick: input, board: args.board, teams: args.teams, nextDraftYear: args.nextDraftYear })
    if (quote.value == null) {
      withhold(i, quote.reason)
      return
    }
    const line = lines[i]!
    const { unpriced: _u, unpricedReason: _r, ...rest } = line
    // Still a PICK line (no position rules or roster need); `dataSource: 'devy-pick'` keeps the learned
    // ROOKIE-slot pick market (`tradeMarketOverlay`) from moving it.
    lines[i] = { ...rest, marketValue: quote.value, dataSource: 'devy-pick', pricedSource: 'pick' }
    const p = priced[i]
    const { unpriced: _pu, unpricedReason: _pr, ...prest } = p ?? ({ name: line.name, type: 'pick', value: 0, assetValue: { marketValue: 0, impactValue: 0, vorpValue: 0, volatility: 0 }, source: 'devy-option' } as PricedAsset)
    priced[i] = {
      ...prest,
      type: 'pick',
      value: quote.value,
      assetValue: { marketValue: quote.value, impactValue: 0, vorpValue: 0, volatility: 0 },
      // The number IS a devy option value — the prospect the pick selects.
      source: 'devy-option',
    }
    devyPicksPriced += 1
  })
  return { lines, priced, devyPicksPriced, refused }
}
