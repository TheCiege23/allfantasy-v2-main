/**
 * The one grade for a COLLEGE REDRAFT league: points over replacement, this season only.
 *
 * Guap's decision for Phase 8 (2026-09-27): a player in a college redraft league is worth what he
 * adds over the best free agent at his position, for the college weeks still to be played, scored
 * under the league's own rules. That replaces the private scale NCAAF trades were graded on —
 * `SportsPlayerRecord` `dynastyValue × 75` / `projection × 45` plus an NFL scoring fit — which was a
 * number with no unit, on an NFL chart, for a sport the chart does not cover.
 *
 * PURE. The loader (`./ncaafRedraftContext.ts`) reads the rosters, projections, free agents and the
 * schedule; this module prices a deal against what it read, so every rule here is testable without a
 * database.
 *
 * ── The rules, each a refusal rather than a guess ───────────────────────────────────────────────
 *   - A player must resolve to EXACTLY ONE rostered player in this league, by id when the surface has
 *     one and otherwise by a name no other rostered player shares. ~4,925 of 7,248 college names
 *     collide, so the whole-sport name lookup the old path used is exactly how a stranger got priced.
 *   - A player with no league-scored projection is not priced as zero; the deal is not graded.
 *   - A position with no projected free agent has no replacement level, and a zero would silently
 *     price that position at full points against every other one. Not graded.
 *   - Draft picks are not part of a redraft league. FAAB has no price on a points scale. Both refuse.
 *
 * ⚠ WEEKS REMAINING DOES NOT MOVE THE LETTER. It is one multiplier on every player (college byes are
 * not on file per player, so nobody gets a bye discount), and the grade is a percentage gap. It sets
 * the size of the numbers a manager is shown — "about 40 points over the rest of the season" — and
 * whether there is a season left to grade at all.
 */

import { gradeTrade, type TradeGradeLine, type TradeGradeView } from './tradeGrade'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import type { LeagueGrade } from '@/lib/trade-value-console/leagueGrade'
import { playerNamesAgree } from '@/lib/player-identity/externalIdNamespace'

/** A rostered player in this league, in the league's own id space. */
export type NcaafRosteredPlayer = {
  rosterPlayerId: string
  name: string
  position: string | null
}

/** Per-game points under this league's rules, for one player. */
export type NcaafPerGame = { perGame: number; position: string | null }

/** The best free agent at one position: who, and his per-game points under this league's rules. */
export type NcaafReplacement = { name: string; perGame: number }

/** The college weeks still to be played, from the schedule. */
export type NcaafSeasonWindow = { season: number; fromWeek: number; toWeek: number; weeks: number }

export type NcaafRedraftContext = {
  rostered: readonly NcaafRosteredPlayer[]
  perGameByRosterId: ReadonlyMap<string, NcaafPerGame>
  /** Keyed by upper-cased position. */
  replacementByPosition: ReadonlyMap<string, NcaafReplacement>
  window: NcaafSeasonWindow
}

export const NCAAF_REDRAFT_PICKS_REASON =
  'Draft picks are not part of a college redraft league — there is no next season for them to be used in — so a deal carrying one is not graded.'
export const NCAAF_PICKS_UNPRICED_REASON =
  'College draft picks have no price yet, so a deal carrying one is not graded.'
export const NCAAF_FAAB_REASON =
  'FAAB has no price on the points-over-replacement scale this league is graded on, so a deal carrying it is not graded.'

const round1 = (n: number) => Math.round(n * 10) / 10

/** "weeks 5–15 of the 2026 college season" — the unit every value here is in. */
export function ncaafWindowText(w: NcaafSeasonWindow): string {
  const span = w.fromWeek === w.toWeek ? `week ${w.fromWeek}` : `weeks ${w.fromWeek}–${w.toWeek}`
  return `${span} of the ${w.season} college season`
}

export function ncaafRedraftBasis(w: NcaafSeasonWindow): string {
  return `Points over the best free agent at each position for ${ncaafWindowText(w)}, scored under this league’s rules. College byes are not on file per player, so no bye is taken off anyone.`
}

/**
 * One rostered player, or why not. An id is authoritative; a name must be carried by exactly one
 * rostered player (`playerNamesAgree` — "Jr." and punctuation do not make two people).
 */
export function resolveNcaafRosteredPlayer(
  asset: { rosterPlayerId?: string; name?: string },
  rostered: readonly NcaafRosteredPlayer[],
): { ok: true; player: NcaafRosteredPlayer } | { ok: false; reason: string } {
  const id = String(asset.rosterPlayerId ?? '').trim()
  const label = String(asset.name ?? '').trim() || id || 'A player'
  if (id) {
    const byId = rostered.find((p) => p.rosterPlayerId === id)
    return byId ? { ok: true, player: byId } : { ok: false, reason: `${label} is not on a roster in this league.` }
  }
  const name = String(asset.name ?? '').trim()
  if (!name) return { ok: false, reason: 'A player in this deal has no name or id to find him by.' }
  const matches = rostered.filter((p) => playerNamesAgree(p.name, name))
  if (matches.length === 1) return { ok: true, player: matches[0]! }
  if (matches.length === 0) return { ok: false, reason: `${name} is not on a roster in this league.` }
  return { ok: false, reason: `${name} matches ${matches.length} rostered players in this league, so it is not clear who is being traded.` }
}

type Priced = { name: string; value: number }

function priceSide(
  assets: readonly TradeAssetInput[],
  ctx: NcaafRedraftContext,
): { priced: Priced[] } | { withheld: string } {
  const priced: Priced[] = []
  for (const asset of assets) {
    if (asset.kind === 'pick') return { withheld: NCAAF_REDRAFT_PICKS_REASON }
    if (asset.kind === 'faab') return { withheld: NCAAF_FAAB_REASON }
    const found = resolveNcaafRosteredPlayer(asset, ctx.rostered)
    if (!found.ok) return { withheld: `${found.reason} This deal is not graded.` }
    const { player } = found
    const line = ctx.perGameByRosterId.get(player.rosterPlayerId)
    if (!line) {
      return { withheld: `${player.name} has no college projection scored under this league’s rules, so this deal is not graded.` }
    }
    const position = String(line.position ?? player.position ?? '').trim().toUpperCase()
    const replacement = position ? ctx.replacementByPosition.get(position) : undefined
    if (!replacement) {
      return {
        withheld: `No free agent at ${position || `${player.name}’s position`} has a college projection, so there is no replacement level to measure ${player.name} against. This deal is not graded.`,
      }
    }
    // Below the best free agent is worth nothing more than the free agent: he can be picked up instead.
    const overPerGame = Math.max(0, line.perGame - replacement.perGame)
    priced.push({ name: player.name, value: overPerGame * ctx.window.weeks })
  }
  return { priced }
}

/**
 * The one grade for a deal in a college redraft league. `give` is what the graded side sends.
 *
 * Returns a withheld view with the reason whenever any asset cannot be priced on this basis — never a
 * letter drawn from part of the deal.
 */
export function gradeNcaafRedraftDeal(args: {
  give: readonly TradeAssetInput[]
  get: readonly TradeAssetInput[]
  ctx: NcaafRedraftContext
}): TradeGradeView {
  const { ctx } = args
  const basis = ncaafRedraftBasis(ctx.window)
  if (ctx.window.weeks <= 0) {
    return { graded: false, reason: `The ${ctx.window.season} college regular season has no weeks left to play, so there is nothing to grade this deal on.`, basis }
  }
  const give = priceSide(args.give, ctx)
  if ('withheld' in give) return { graded: false, reason: give.withheld, basis }
  const get = priceSide(args.get, ctx)
  if ('withheld' in get) return { graded: false, reason: get.withheld, basis }

  const giveTotal = give.priced.reduce((s, p) => s + p.value, 0)
  const getTotal = get.priced.reduce((s, p) => s + p.value, 0)
  if (giveTotal <= 0 && getTotal <= 0) {
    return {
      graded: false,
      reason: 'Nobody in this deal is projected above the best free agent at his position — every player in it could be replaced from the wire.',
      basis,
    }
  }

  const lines: TradeGradeLine[] = [
    ...give.priced.map((p) => ({ side: 'give' as const, name: p.name, marketValue: round1(p.value), leagueValue: round1(p.value), source: 'ncaaf-redraft-vorp' })),
    ...get.priced.map((p) => ({ side: 'get' as const, name: p.name, marketValue: round1(p.value), leagueValue: round1(p.value), source: 'ncaaf-redraft-vorp' })),
  ]
  /*
   * ⚠ A SIDE WORTH NOTHING OVER REPLACEMENT IS A REAL ANSWER, NOT A MISSING ONE. `gradeTrade` refuses
   * a side that is not above zero, because on a chart a zero means "unpriced". Here it means "every
   * player on that side is replaceable from the wire", and a star for three of them is the clearest
   * grade there is. A hundredth of a point keeps it gradable without moving any displayed number.
   */
  const FLOOR = 0.01
  return gradeTrade({
    giveValue: Math.max(giveTotal, FLOOR),
    getValue: Math.max(getTotal, FLOOR),
    giveMarket: giveTotal,
    getMarket: getTotal,
    unpriced: 0,
    giveCount: args.give.length,
    getCount: args.get.length,
    basis,
    scoringApplied: true,
    needApplied: false,
    needGap: null,
    lines,
    moves: [],
  })
}

/** Which sports and league types this module grades. */
export function isNcaafRedraft(sport: string | null | undefined, leagueType: string | null | undefined): boolean {
  return String(sport ?? '').trim().toUpperCase() === 'NCAAF' && String(leagueType ?? '').trim().toLowerCase() === 'redraft'
}

/** Why a deal in a non-redraft college league carrying a pick is not graded (Phase 9 prices them). */
export function ncaafPickRefusal(assets: readonly TradeAssetInput[], isRedraft: boolean): string | null {
  if (!assets.some((a) => a.kind === 'pick')) return null
  return isRedraft ? NCAAF_REDRAFT_PICKS_REASON : NCAAF_PICKS_UNPRICED_REASON
}

/**
 * The college weeks still to be played, from the schedule's own week and its last regular-season week.
 *
 * The current week counts while it is still to be played or under way: a player whose game is later
 * this weekend still scores for you. A week the schedule reports as played or between slates does not.
 * Null when the schedule cannot answer — there is no fallback week.
 */
export function ncaafSeasonWindow(args: {
  season: number
  current: { state: 'upcoming' | 'live' | 'between' | 'played'; sportWeek: number; nextSportWeek: number | null } | null
  lastRegularWeek: number | null
}): NcaafSeasonWindow | null {
  const { season, current, lastRegularWeek } = args
  if (!current || lastRegularWeek == null || !Number.isFinite(lastRegularWeek)) return null
  const from = current.state === 'upcoming' || current.state === 'live' ? current.sportWeek : current.nextSportWeek
  if (from == null || from > lastRegularWeek) return { season, fromWeek: lastRegularWeek + 1, toWeek: lastRegularWeek, weeks: 0 }
  return { season, fromWeek: from, toWeek: lastRegularWeek, weeks: lastRegularWeek - from + 1 }
}

/**
 * Rewrite the Trade Center console's own numbers from a college grade, IN PLACE, so every figure the
 * console derives afterwards — its totals, gap, fairness score and basis line — is on the grade's basis.
 *
 * ⚠ LEFT ALONE, THE CONSOLE WOULD SHOW ONE BASIS AND GRADE ON ANOTHER: its lines and totals come from
 * the chart pricer (`resolveAssets`), which for a college player is the private scale this phase
 * retires. When the deal is not graded, the chart numbers are cleared rather than shown beside "not
 * graded" as if they were this league's values.
 */
export function applyCollegeGrade(leagueGrade: LeagueGrade, view: TradeGradeView): void {
  if (!view.graded) {
    for (const l of [...leagueGrade.giveLines, ...leagueGrade.getLines]) {
      l.leagueValue = null
      l.valueAdjustments = []
    }
    Object.assign(leagueGrade.totals, { giveLeague: 0, getLeague: 0, percentDiff: 0 })
    Object.assign(leagueGrade.valueBasis, {
      label: view.basis ?? `Not graded: ${view.reason}`,
      scoringAdjusted: false,
      needAdjusted: false,
      needGap: null,
    })
    return
  }
  const bySide = (side: 'give' | 'get') => view.lines.filter((l) => l.side === side)
  const rewrite = (lines: LeagueGrade['giveLines'], graded: TradeGradeLine[]) => {
    lines.forEach((l, i) => {
      const g = lines.length === graded.length ? graded[i] : undefined
      l.marketValue = g?.marketValue ?? 0
      l.leagueValue = g?.leagueValue ?? null
      l.valueAdjustments = []
    })
  }
  rewrite(leagueGrade.giveLines, bySide('give'))
  rewrite(leagueGrade.getLines, bySide('get'))
  Object.assign(leagueGrade.totals, {
    giveBase: view.giveMarket,
    getBase: view.getMarket,
    giveLeague: view.giveValue,
    getLeague: view.getValue,
    percentDiff: view.percentDiff,
    unpriced: 0,
  })
  Object.assign(leagueGrade.valueBasis, { graded: 'league', label: view.basis, scoringAdjusted: true, needAdjusted: false, needGap: null })
}

/** The positions of the players in a deal, as the projection feed files them — what a replacement is needed for. */
export function ncaafDealPositions(
  assets: readonly TradeAssetInput[],
  rostered: readonly NcaafRosteredPlayer[],
  perGameByRosterId: ReadonlyMap<string, NcaafPerGame>,
): string[] {
  const out = new Set<string>()
  for (const asset of assets) {
    if (asset.kind !== 'player') continue
    const found = resolveNcaafRosteredPlayer(asset, rostered)
    if (!found.ok) continue
    const position = String(perGameByRosterId.get(found.player.rosterPlayerId)?.position ?? found.player.position ?? '').trim().toUpperCase()
    if (position) out.add(position)
  }
  return [...out]
}
