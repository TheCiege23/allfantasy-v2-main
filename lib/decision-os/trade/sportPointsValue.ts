/**
 * The one grade for a POINTS league in the daily sports — NBA, college basketball, NHL: points over the
 * best free agent at each position, for the regular-season games still to play, scored under the
 * league's own rules. The college-football redraft grade (`./ncaafRedraftValue.ts`) is the template;
 * this is the same rule for the sports that had no grade at all (trade grade audit, 2026-10-09).
 *
 * PURE. The loader (`./sportPointsContext.ts`) reads the projection board, the league's rules, rosters
 * and schedule; this module prices a deal against what it read.
 *
 * ── The rules, each a refusal rather than a guess ───────────────────────────────────────────────
 *   - A player must resolve to EXACTLY ONE player on the projection board: by id when the surface has
 *     one (identity id, Rolling Insights id, Sleeper id), otherwise by a name no other board player shares.
 *   - A projection resting on fewer than MIN_SAMPLE_GAMES games is not a price. Hockey's board this
 *     week is built from 2–4 games of the new season and ranks fringe defencemen above Connor McDavid;
 *     grading on it would be confident and wrong.
 *   - A position with no free agent above the sample bar has no replacement level, so the deal is not
 *     graded — a zero would price that position at full points against every other one.
 *   - Draft picks and FAAB have no price on a points-over-replacement scale. Both refuse.
 *
 * ⚠ DOUBLE- AND TRIPLE-DOUBLE BONUSES ARE NOT PROJECTED. The stat normalizer derives them from ONE
 * game's line. Applied to a season AVERAGE, a 12-point, 10-rebound player would collect a double-double
 * every night. They are removed from the projected line and the basis says so.
 *
 * ⚠ GAMES REMAINING DOES NOT MOVE THE LETTER. It is one multiplier on every player (the schedule gives
 * every team within a couple of games of each other), and the grade is a percentage gap. It sets the size
 * of the numbers a manager is shown and whether there is a season left to grade.
 */

import { gradeTrade, type TradeGradeLine, type TradeGradeView } from './tradeGrade'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { playerNamesAgree } from '@/lib/player-identity/externalIdNamespace'

/** Sports this grade covers. MLB is not here: its projection board carries no batting or pitching rates. */
export type PointsGradedSport = 'NBA' | 'NCAAB' | 'NHL'

export function isPointsGradedSport(sport: string | null | undefined): sport is PointsGradedSport {
  const s = String(sport ?? '').trim().toUpperCase()
  return s === 'NBA' || s === 'NCAAB' || s === 'NHL'
}

const SPORT_LABEL: Record<PointsGradedSport, string> = { NBA: 'NBA', NCAAB: 'college basketball', NHL: 'NHL' }

/** Fewer games than this behind a projection and it is not a price. */
export const MIN_SAMPLE_GAMES = 10

/** One player on the projection board, already scored under the league's rules. */
export type BoardPlayer = {
  /** The projection's own id (`PlayerIdentityMap.id`). */
  id: string
  name: string
  /** As the projection files it (PG, SG, SF, PF, C · G, F, C · C, LW, RW, D, G). */
  position: string
  /** Fantasy points per game under the league's rules, bonuses derived from one game removed. */
  perGame: number
  /** Games behind the projection, when the projection says. */
  sampleGames: number | null
  /** Every other id this player is known by (Rolling Insights, Sleeper), for resolving a surface's id. */
  aliases: readonly string[]
  /** The season the projection's numbers come from (last season, until this one has games). */
  sourceSeason?: number | null
}

/**
 * Below this share of the board clearing the sample bar, the board is mid-switch to a new season and its
 * replacement levels would be computed from a fragment. Measured 2026-10-09: NBA 516 of 585 (88%) clear
 * it; NHL 219 of 1,049 (21%) — 707 of its projections already rest on 2–4 games of the new season.
 */
export const MIN_BOARD_COVERAGE = 0.6

/** A starting lineup slot: how many per team and which positions may fill it. */
export type LineupSlot = { slot: string; eligible: readonly string[]; count: number }

export type SportSeasonWindow = {
  season: number
  seasonLabel: string
  gamesRemaining: number
  /** When the projections still come from an earlier season, that season's label ("2025-26"). */
  baselineSeasonLabel?: string | null
}

export type SportPointsContext = {
  sport: PointsGradedSport
  board: readonly BoardPlayer[]
  /** Best free agent per position (upper-cased), already computed against this league. */
  replacementByPosition: ReadonlyMap<string, { name: string; perGame: number }>
  window: SportSeasonWindow
  /** How the scoring was chosen: this league's rules, or the sport's defaults with no league. */
  scoringBasis: 'league' | 'default'
  teams: number
  /**
   * What `perGame` measures: fantasy points, or — in a category league — the sum of the player's per-game
   * category scores (`./sportCategoryValue.ts`). Absent means points.
   */
  valueKind?: 'points' | 'categories'
  /** In a category league, the categories valued ("PTS, REB, … and TO"). */
  categoryList?: string | null
}

export const SPORT_PICKS_REASON = (sport: PointsGradedSport) =>
  `Draft picks have no ${SPORT_LABEL[sport]} price yet, so a deal carrying one is not graded.`
export const SPORT_FAAB_REASON =
  'FAAB has no price on the over-replacement scale this sport is graded on, so a deal carrying it is not graded.'

const round1 = (n: number) => Math.round(n * 10) / 10

export function sportPointsBasis(
  ctx: Pick<SportPointsContext, 'sport' | 'window' | 'scoringBasis' | 'teams' | 'valueKind' | 'categoryList'>,
): string {
  const label = SPORT_LABEL[ctx.sport]
  const baseline = ctx.window.baselineSeasonLabel
    ? ` Projections are built from the ${ctx.window.baselineSeasonLabel} season until this one has enough games.`
    : ''
  const season = `the rest of the ${ctx.window.seasonLabel} ${label} regular season (about ${ctx.window.gamesRemaining} games)`
  if (ctx.valueKind === 'categories') {
    const where =
      ctx.scoringBasis === 'league'
        ? 'this league’s categories'
        : `a standard ${ctx.teams}-team head-to-head category league`
    // Only what this league's categories actually hold: the 8-category standard has no turnovers.
    const named = new Set((ctx.categoryList ?? '').split(/, | and /))
    const notes = [
      named.has('FG%') || named.has('FT%') ? 'percentages are weighted by shot volume' : null,
      named.has('TO') ? 'turnovers count against' : null,
    ].filter(Boolean)
    const how = notes.length ? ` ${notes.join(' and ').replace(/^./, (c) => c.toUpperCase())}.` : ''
    return `Category value over the best free agent at each position for ${season}, on ${where}: each category is scored as standard deviations above or below the rosterable player pool, per game, then summed across ${ctx.categoryList ?? 'the categories'}.${how} Punting a category is not modelled.${baseline}`
  }
  const scoring =
    ctx.scoringBasis === 'league'
      ? 'scored under this league’s rules'
      : `scored on AllFantasy’s default ${label} points for a ${ctx.teams}-team league with standard lineups`
  const bonus = ctx.sport === 'NHL' ? '' : ' Double-double and triple-double bonuses are not projected.'
  return `Points over the best free agent at each position for ${season}, ${scoring}.${bonus}${baseline}`
}

/**
 * Why a whole projection board cannot be graded on yet, or null. Two cases, both measured 2026-10-09:
 *   - the board is mid-switch to a new season (too little of it clears the sample bar) — hockey today;
 *   - college basketball still projecting from LAST season. College rosters turn over every year, so last
 *     season's board carries players who have left — it ranked Cameron Boozer, now in the NBA, first — and
 *     they would set the replacement level as "free agents".
 */
export function boardReadinessReason(args: {
  sport: PointsGradedSport
  board: readonly BoardPlayer[]
  season: number
  seasonLabel: string
}): string | null {
  const label = SPORT_LABEL[args.sport]
  if (args.board.length === 0) return `No ${label} projection could be scored, so this deal cannot be graded.`
  // College first: its cause is the turnover, and a thin board is only a symptom of it.
  if (args.sport === 'NCAAB') {
    const prior = args.board.filter((p) => p.sourceSeason != null && p.sourceSeason < args.season).length
    if (prior / args.board.length > 0.5) {
      return `College rosters turn over every year, and these projections still come from last season, which includes players who have since left. College basketball grades start once the ${args.seasonLabel} season has games behind it.`
    }
  }
  const cleared = args.board.filter(meetsSampleBar).length
  if (cleared / args.board.length < MIN_BOARD_COVERAGE) {
    return `${label[0]!.toUpperCase()}${label.slice(1)} projections are switching to the ${args.seasonLabel} season, and most players have fewer than ${MIN_SAMPLE_GAMES} games behind them, so grades pause until the board fills in.`
  }
  return null
}

/** Games behind a projection, read from its own confidence reasons ("65 games in the season sample"). */
export function sampleGamesFromReasons(reasons: unknown): number | null {
  if (!Array.isArray(reasons)) return null
  for (const r of reasons) {
    const m = /(\d+)\s+games?\s+in the season sample/i.exec(String(r))
    if (m) return Number(m[1])
  }
  return null
}

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/**
 * Why a CATEGORY league whose categories could not be read is not graded. A category league is won
 * category by category, so a points total answers a different question — it must never fall back to the
 * points grade. The loader values the standard presets it can read (`./sportCategoryValue.ts`); this is
 * for the rest (custom category lists, roto basketball). Read only from stored modes, never from a label.
 */
export function categoryLeagueReason(settings: unknown, sport: PointsGradedSport): string | null {
  const s = isRecord(settings) ? settings : {}
  const modes = [s.scoring_mode, s.scoring_type, s.scoringType, isRecord(s.scoringSettings) ? s.scoringSettings.categoryType : undefined]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter(Boolean)
  const category = modes.some((m) => m === 'head' || m.includes('cat') || m.includes('roto'))
  if (!category) return null
  return `This league scores ${SPORT_LABEL[sport]} by categories we could not read — category grades cover the standard 8- and 9-category head-to-head setups so far — and a points total would answer a different question, so this deal is not graded.`
}

/**
 * Why a league that keeps players past this season is not graded here. This grade counts THIS season
 * only; in a dynasty or keeper league that ignores every season after it — young players most of all —
 * and no market prices those seasons for this sport yet.
 */
export function multiSeasonFormatReason(leagueType: string | null | undefined, sport: PointsGradedSport): string | null {
  const t = String(leagueType ?? '').trim().toLowerCase()
  const kept = t.includes('dynasty') || t === 'keeper' || t === 'devy' || t === 'c2c' || t === 'salary_cap'
  if (!kept) return null
  return `This is a ${t.replace('_', ' ')} league, and ${SPORT_LABEL[sport]} grades so far count this season only — that would ignore every season after it, young players most of all. This deal is not graded.`
}

export function meetsSampleBar(p: Pick<BoardPlayer, 'sampleGames'>): boolean {
  return p.sampleGames == null || p.sampleGames >= MIN_SAMPLE_GAMES
}

/**
 * One board player, or why not. Any id the surface carries is tried against the projection id and every
 * alias, with a sport prefix (`NBA:114`) stripped; a name must be carried by exactly one board player.
 */
export function resolveBoardPlayer(
  asset: { playerId?: string | null; name?: string | null },
  board: readonly BoardPlayer[],
  index?: ReadonlyMap<string, BoardPlayer>,
): { ok: true; player: BoardPlayer } | { ok: false; reason: string } {
  const label = String(asset.name ?? '').trim() || String(asset.playerId ?? '').trim() || 'A player'
  const raw = String(asset.playerId ?? '').trim()
  if (raw) {
    const byId = index ?? indexBoard(board)
    const bare = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw
    const hit = byId.get(raw) ?? byId.get(bare)
    if (hit) return { ok: true, player: hit }
  }
  const name = String(asset.name ?? '').trim()
  if (!name) return { ok: false, reason: `${label} has no projection on file.` }
  const matches = board.filter((p) => playerNamesAgree(p.name, name))
  if (matches.length === 1) return { ok: true, player: matches[0]! }
  if (matches.length === 0) return { ok: false, reason: `${name} has no projection on file for this season.` }
  return { ok: false, reason: `${name} matches ${matches.length} players with projections, so it is not clear who is being traded.` }
}

/** Every id a board player answers to, mapped to him. An id two players share answers to neither. */
export function indexBoard(board: readonly BoardPlayer[]): Map<string, BoardPlayer> {
  const out = new Map<string, BoardPlayer>()
  const clashed = new Set<string>()
  for (const p of board) {
    for (const id of [p.id, ...p.aliases]) {
      if (!id || clashed.has(id)) continue
      const prior = out.get(id)
      if (prior && prior !== p) {
        out.delete(id)
        clashed.add(id)
        continue
      }
      out.set(id, p)
    }
  }
  return out
}

/**
 * The best free agent at each position, when the league's rosters are known: the highest-scoring board
 * player at that position who meets the sample bar and is on no roster.
 */
export function replacementFromRosters(
  board: readonly BoardPlayer[],
  rosteredBoardIds: ReadonlySet<string>,
): Map<string, { name: string; perGame: number }> {
  const out = new Map<string, { name: string; perGame: number }>()
  for (const p of board) {
    if (rosteredBoardIds.has(p.id) || !meetsSampleBar(p)) continue
    const pos = p.position.trim().toUpperCase()
    const best = out.get(pos)
    if (!best || p.perGame > best.perGame) out.set(pos, { name: p.name, perGame: p.perGame })
  }
  return out
}

/**
 * The best free agent at each position when no rosters are known (the open analyzer, or a league whose
 * rosters could not be read): fill every team's starting slots, most restrictive slot first, then its
 * bench, from the best players down; whoever is left is the waiver wire.
 */
export function replacementFromLineups(
  board: readonly BoardPlayer[],
  args: { teams: number; slots: readonly LineupSlot[]; benchPerTeam: number },
): Map<string, { name: string; perGame: number }> {
  const ordered = board.filter(meetsSampleBar).slice().sort((a, b) => b.perGame - a.perGame)
  const capacity = args.slots
    .map((s) => ({ eligible: new Set(s.eligible.map((e) => e.toUpperCase())), left: Math.max(0, s.count) * args.teams }))
    .sort((a, b) => a.eligible.size - b.eligible.size)
  let bench = Math.max(0, args.benchPerTeam) * args.teams
  const free: BoardPlayer[] = []
  for (const p of ordered) {
    const pos = p.position.trim().toUpperCase()
    const slot = capacity.find((c) => c.left > 0 && c.eligible.has(pos))
    if (slot) {
      slot.left -= 1
      continue
    }
    // No starting slot left for him: a bench spot if one is left, otherwise he is available.
    if (bench > 0) {
      bench -= 1
      continue
    }
    free.push(p)
  }
  const out = new Map<string, { name: string; perGame: number }>()
  for (const p of free) {
    const pos = p.position.trim().toUpperCase()
    if (!out.has(pos)) out.set(pos, { name: p.name, perGame: p.perGame })
  }
  return out
}

type Priced = { name: string; value: number }

function priceSide(
  assets: readonly TradeAssetInput[],
  ctx: SportPointsContext,
  index: ReadonlyMap<string, BoardPlayer>,
): { priced: Priced[] } | { withheld: string } {
  const priced: Priced[] = []
  for (const asset of assets) {
    if (asset.kind === 'pick') return { withheld: SPORT_PICKS_REASON(ctx.sport) }
    if (asset.kind === 'faab') return { withheld: SPORT_FAAB_REASON }
    const found = resolveBoardPlayer({ playerId: asset.playerId ?? null, name: asset.name ?? null }, ctx.board, index)
    if (!found.ok) return { withheld: `${found.reason} This deal is not graded.` }
    const { player } = found
    if (!meetsSampleBar(player)) {
      return {
        withheld: `${player.name}’s projection rests on ${player.sampleGames} game${player.sampleGames === 1 ? '' : 's'}, too few to price — grades start at ${MIN_SAMPLE_GAMES} games. This deal is not graded.`,
      }
    }
    const pos = player.position.trim().toUpperCase()
    const replacement = ctx.replacementByPosition.get(pos)
    if (!replacement) {
      return {
        withheld: `No free agent at ${pos || `${player.name}’s position`} has a projection to measure ${player.name} against, so there is no replacement level. This deal is not graded.`,
      }
    }
    // Below the best free agent is worth nothing more than the free agent: he can be picked up instead.
    priced.push({ name: player.name, value: Math.max(0, player.perGame - replacement.perGame) * ctx.window.gamesRemaining })
  }
  return { priced }
}

/**
 * The one grade for a deal in a daily-sport points league. `give` is what the graded side sends.
 * Withheld, with the reason, whenever any asset cannot be priced on this basis — never a letter drawn
 * from part of the deal.
 */
export function gradeSportPointsDeal(args: {
  give: readonly TradeAssetInput[]
  get: readonly TradeAssetInput[]
  ctx: SportPointsContext
}): TradeGradeView {
  const { ctx } = args
  const basis = sportPointsBasis(ctx)
  if (ctx.window.gamesRemaining <= 0) {
    return { graded: false, reason: `The ${ctx.window.seasonLabel} ${SPORT_LABEL[ctx.sport]} regular season has no games left to play, so there is nothing to grade this deal on.`, basis }
  }
  const index = indexBoard(ctx.board)
  const give = priceSide(args.give, ctx, index)
  if ('withheld' in give) return { graded: false, reason: give.withheld, basis }
  const get = priceSide(args.get, ctx, index)
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
  const source = `${ctx.sport.toLowerCase()}-${ctx.valueKind === 'categories' ? 'category' : 'points'}-vorp`
  const lines: TradeGradeLine[] = [
    ...give.priced.map((p) => ({ side: 'give' as const, name: p.name, marketValue: round1(p.value), leagueValue: round1(p.value), source, valueSource: 'sport_projection' as const, valueAsOf: null })),
    ...get.priced.map((p) => ({ side: 'get' as const, name: p.name, marketValue: round1(p.value), leagueValue: round1(p.value), source, valueSource: 'sport_projection' as const, valueAsOf: null })),
  ]
  /*
   * A side worth nothing over replacement is a real answer ("every player here is replaceable"), not a
   * missing one; a hundredth of a point keeps it gradable without moving a displayed number — the same
   * floor the college grade uses.
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
    scoringApplied: ctx.scoringBasis === 'league',
    needApplied: false,
    needGap: null,
    lines,
    moves: [],
  })
}
