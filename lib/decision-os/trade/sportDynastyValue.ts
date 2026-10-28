/**
 * The multi-season (dynasty) grade for NBA, NHL and MLB: the same points-over-replacement price as the
 * one-season grade (`./sportPointsValue.ts`), counted for this season AND the next four, each future
 * season moved by the player's age on his sport's aging curve. Draft picks are priced too.
 *
 * Owner's decision, 2026-10-27: dynasty leagues in these sports get a grade managers see, and picks get
 * a value. Before this every dynasty deal in them was withheld (`multiSeasonFormatReason`), so the
 * lopsided, repeat-partner and deadline-rush collusion checks could never run there — they read the
 * one grade (`./tradeReviewContext.ts`).
 *
 * PURE. The loader (`./sportPointsContext.ts`) reads the ages; this module prices against them.
 *
 * ── A player ─────────────────────────────────────────────────────────────────────────────────────
 *   season 0   (perGame − replacement) × games left this season          — the one-season grade, unchanged
 *   season y   (perGame × curve(age + y) / curve(age) − replacement) × a full season × FUTURE_DISCOUNT^y
 * Each season floors at zero: a player below the free agent is worth what the free agent is, not less.
 * `curve` is the repo's one aging curve (`lib/dynasty-engine/AgingCurveService.ts`, peak ages per sport
 * and position from `SportDynastyResolver`). Today's per-game line already reflects today's age, so a
 * future season moves it by the RATIO of the curve, never by the curve itself.
 *
 * ── A draft pick ─────────────────────────────────────────────────────────────────────────────────
 * Worth the dynasty value of the young player ranked at the pick's spot: the league's young players
 * (at most YOUNG_POOL_MAX_AGE, on today's board) sorted best first, and pick N of the draft is the Nth.
 * They are what past picks became — the honest price of a pick is what picks turn into. A pick in a
 * later draft waits one discount per year, and NHL and MLB draftees usually spend seasons in junior or
 * the minors before they score, so those wait PROSPECT_WAIT_SEASONS more. Where in a round the pick
 * lands comes from its tier (early / mid / late), mid when nobody knows.
 *
 * ⚠ THESE ARE ESTIMATES AND THE BASIS SAYS SO. Ages on file are accurate to about a year
 * (`lib/sports-data/playerAge.ts`), the curve is a shape rather than a fit to these sports' data, and
 * the young pool only holds players good enough to have a projection — which flatters a pick. Every
 * choice is a named constant below so it can be tuned in one place.
 *
 * Refusals, never guesses: a player with no age on file, a pick for a draft already held, a pick
 * deeper than the young pool, and FAAB all withhold the grade with the reason.
 */

import { ageMultiplierAtAge } from '@/lib/dynasty-engine/AgingCurveService'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { gradeTrade, type TradeGradeLine, type TradeGradeView } from './tradeGrade'
import {
  indexBoard,
  meetsSampleBar,
  MIN_SAMPLE_GAMES,
  resolveBoardPlayer,
  SPORT_FAAB_REASON,
  sportPointsBasis,
  type BoardPlayer,
  type SportPointsContext,
} from './sportPointsValue'

export type DynastyGradedSport = 'NBA' | 'NHL' | 'MLB'

export function isDynastyGradedSport(sport: string | null | undefined): sport is DynastyGradedSport {
  const s = String(sport ?? '').trim().toUpperCase()
  return s === 'NBA' || s === 'NHL' || s === 'MLB'
}

/** League types this grade covers. Keeper, salary-cap, devy and C2C keep their own refusal. */
export function isDynastyLeagueType(leagueType: string | null | undefined): boolean {
  return String(leagueType ?? '').trim().toLowerCase().includes('dynasty')
}

/** This season and the next four. */
export const DYNASTY_SEASONS = 5
/** Each season after this one counts for this share of the one before it. */
export const FUTURE_DISCOUNT = 0.85
/** A full regular season, for every season after this one. */
export const FULL_SEASON_GAMES: Record<DynastyGradedSport, number> = { NBA: 82, NHL: 82, MLB: 162 }
/** Players this age or younger make up the pool a draft pick is priced from. */
export const YOUNG_POOL_MAX_AGE: Record<DynastyGradedSport, number> = { NBA: 22, NHL: 22, MLB: 24 }
/** Seasons a new draftee usually waits before he scores: junior hockey, the minor leagues. */
export const PROSPECT_WAIT_SEASONS: Record<DynastyGradedSport, number> = { NBA: 0, NHL: 2, MLB: 2 }

/** What the loader adds to a dynasty league's context. */
export type SportDynastyContext = {
  /** Board id → age today. A player missing here has no age on file. */
  ages: ReadonlyMap<string, number>
  /** The next rookie draft's year: a pick for an earlier one has been used. */
  nextDraftYear: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** A player's dynasty value: seasons over replacement, this one first, each later one aged and discounted. */
export function playerDynastyValue(args: {
  sport: DynastyGradedSport
  player: Pick<BoardPlayer, 'position' | 'perGame'>
  age: number
  replacementPerGame: number
  gamesRemaining: number
}): number {
  const { sport, player, age, replacementPerGame } = args
  const now = ageMultiplierAtAge(sport, player.position, age)
  let total = Math.max(0, player.perGame - replacementPerGame) * Math.max(0, args.gamesRemaining)
  for (let y = 1; y < DYNASTY_SEASONS; y++) {
    const perGame = now > 0 ? (player.perGame * ageMultiplierAtAge(sport, player.position, age + y)) / now : player.perGame
    total += Math.max(0, perGame - replacementPerGame) * FULL_SEASON_GAMES[sport] * FUTURE_DISCOUNT ** y
  }
  return total
}

/**
 * The young players a pick is priced from, best first. Only projections that clear the sample bar and
 * have a replacement level count — the same players the grade itself can price.
 */
export function youngPlayerPool(ctx: SportPointsContext & { sport: DynastyGradedSport }, dynasty: SportDynastyContext): number[] {
  const out: number[] = []
  for (const p of ctx.board) {
    const age = dynasty.ages.get(p.id)
    if (age == null || age > YOUNG_POOL_MAX_AGE[ctx.sport] || !meetsSampleBar(p)) continue
    const replacement = ctx.replacementByPosition.get(p.position.trim().toUpperCase())
    if (!replacement) continue
    out.push(playerDynastyValue({ sport: ctx.sport, player: p, age, replacementPerGame: replacement.perGame, gamesRemaining: ctx.window.gamesRemaining }))
  }
  return out.sort((a, b) => b - a)
}

/** The pick's place in its round, 0-based: a third of the way in for early, halfway for mid. */
export function pickSlotInRound(tier: 'early' | 'mid' | 'late' | undefined, teams: number): number {
  const n = Math.max(1, Math.round(teams))
  if (tier === 'early') return Math.floor(n / 6)
  if (tier === 'late') return n - 1 - Math.floor(n / 6)
  return Math.floor(n / 2)
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

export function pickLabel(p: Extract<TradeAssetInput, { kind: 'pick' }>): string {
  return String(p.label ?? '').trim() || `${p.year} ${ordinal(p.round)}-round pick`
}

/** A pick's dynasty value, or why it cannot be priced. */
export function pickDynastyValue(args: {
  sport: DynastyGradedSport
  pick: Extract<TradeAssetInput, { kind: 'pick' }>
  pool: readonly number[]
  teams: number
  nextDraftYear: number
}): { ok: true; value: number } | { ok: false; reason: string } {
  const { pick, sport } = args
  const label = pickLabel(pick)
  if (!Number.isFinite(pick.year) || !Number.isFinite(pick.round) || pick.round < 1) {
    return { ok: false, reason: `${label} does not say which draft and round it is, so it cannot be priced.` }
  }
  if (pick.year < args.nextDraftYear) {
    return { ok: false, reason: `The ${pick.year} draft has already been held, so that pick is a player now. Trade the player drafted with it — this deal is not graded as it stands.` }
  }
  const teams = Math.max(1, Math.round(args.teams))
  const spot = (Math.round(pick.round) - 1) * teams + pickSlotInRound(pick.tier, teams)
  const base = args.pool[spot]
  if (base == null) {
    return {
      ok: false,
      reason: `${label} is deeper than the ${args.pool.length} young ${sport} players with a projection to price it against, so this deal is not graded.`,
    }
  }
  const wait = pick.year - args.nextDraftYear + PROSPECT_WAIT_SEASONS[sport]
  return { ok: true, value: base * FUTURE_DISCOUNT ** wait }
}

export function sportDynastyBasis(ctx: SportPointsContext & { sport: DynastyGradedSport }): string {
  const pointsBasis = sportPointsBasis(ctx)
  const wait = PROSPECT_WAIT_SEASONS[ctx.sport]
  const waitNote = wait > 0 ? `, then waits ${wait} more season${wait === 1 ? '' : 's'} for a draftee to reach the ${ctx.sport}` : ''
  return (
    `Dynasty value: ${pointsBasis.charAt(0).toLowerCase()}${pointsBasis.slice(1)} ` +
    `Then each of the next ${DYNASTY_SEASONS - 1} full seasons is added, moved by the player’s age on the ${ctx.sport} aging curve for his position and counted at ${Math.round(FUTURE_DISCOUNT * 100)}% of the season before. ` +
    `Ages on file are accurate to about a year. ` +
    `A draft pick is worth the dynasty value of the young player (${YOUNG_POOL_MAX_AGE[ctx.sport]} or under) ranked at that pick’s spot today; a later draft waits one season per year${waitNote}. ` +
    `These are estimates, not a market price.`
  )
}

type Priced = { name: string; value: number; kind: 'player' | 'pick' }

/**
 * The dynasty grade for one deal. `give` is what the graded side sends. Withheld, with the reason,
 * whenever any asset cannot be priced — never a letter drawn from part of the deal.
 */
export function gradeSportDynastyDeal(args: {
  give: readonly TradeAssetInput[]
  get: readonly TradeAssetInput[]
  ctx: SportPointsContext & { sport: DynastyGradedSport }
  dynasty: SportDynastyContext
}): TradeGradeView {
  const { ctx, dynasty } = args
  const basis = sportDynastyBasis(ctx)
  const index = indexBoard(ctx.board)
  let pool: number[] | null = null

  const priceSide = (assets: readonly TradeAssetInput[]): { priced: Priced[] } | { withheld: string } => {
    const priced: Priced[] = []
    for (const asset of assets) {
      if (asset.kind === 'faab') return { withheld: SPORT_FAAB_REASON }
      if (asset.kind === 'pick') {
        pool ??= youngPlayerPool(ctx, dynasty)
        const p = pickDynastyValue({ sport: ctx.sport, pick: asset, pool, teams: ctx.teams, nextDraftYear: dynasty.nextDraftYear })
        if (!p.ok) return { withheld: p.reason }
        priced.push({ name: pickLabel(asset), value: p.value, kind: 'pick' })
        continue
      }
      const found = resolveBoardPlayer({ playerId: asset.playerId ?? null, name: asset.name ?? null }, ctx.board, index)
      if (!found.ok) return { withheld: `${found.reason} This deal is not graded.` }
      const { player } = found
      if (!meetsSampleBar(player)) {
        const has = player.sampleBar?.has ?? `${player.sampleGames} game${player.sampleGames === 1 ? '' : 's'}`
        const needs = player.sampleBar?.needs ?? `${MIN_SAMPLE_GAMES} games`
        return { withheld: `${player.name}’s projection rests on ${has}, too few to price — grades start at ${needs}. This deal is not graded.` }
      }
      const pos = player.position.trim().toUpperCase()
      const replacement = ctx.replacementByPosition.get(pos)
      if (!replacement) {
        return { withheld: `No free agent at ${pos || `${player.name}’s position`} has a projection to measure ${player.name} against, so there is no replacement level. This deal is not graded.` }
      }
      const age = dynasty.ages.get(player.id)
      if (age == null) {
        return { withheld: `${player.name} has no age on file, so his seasons after this one cannot be valued. This deal is not graded.` }
      }
      priced.push({
        name: player.name,
        value: playerDynastyValue({ sport: ctx.sport, player, age, replacementPerGame: replacement.perGame, gamesRemaining: ctx.window.gamesRemaining }),
        kind: 'player',
      })
    }
    return { priced }
  }

  const give = priceSide(args.give)
  if ('withheld' in give) return { graded: false, reason: give.withheld, basis }
  const get = priceSide(args.get)
  if ('withheld' in get) return { graded: false, reason: get.withheld, basis }

  const giveTotal = give.priced.reduce((s, p) => s + p.value, 0)
  const getTotal = get.priced.reduce((s, p) => s + p.value, 0)
  if (giveTotal <= 0 && getTotal <= 0) {
    return {
      graded: false,
      reason: 'Nobody in this deal is projected above the best free agent at his position, this season or the next four.',
      basis,
    }
  }
  const source = `${ctx.sport.toLowerCase()}-${ctx.valueKind === 'categories' ? 'category' : 'points'}-dynasty`
  const line = (side: 'give' | 'get') => (p: Priced): TradeGradeLine => ({
    side,
    name: p.name,
    marketValue: round1(p.value),
    leagueValue: round1(p.value),
    source,
    valueSource: p.kind === 'pick' ? 'pick_curve' : 'sport_projection',
    valueAsOf: null,
  })
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
    scoringApplied: ctx.scoringBasis === 'league',
    needApplied: false,
    needGap: null,
    lines: [...give.priced.map(line('give')), ...get.priced.map(line('get'))],
    moves: [],
  })
}
