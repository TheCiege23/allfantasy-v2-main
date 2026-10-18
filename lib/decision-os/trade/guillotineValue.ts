/**
 * Guillotine trade grades — PURE. The loader is `./guillotineContext.ts`; the grader `./guillotineGrader.ts`.
 *
 * Guap, 2026-10-11, on "Malik Willis + $75 FAAB for Joe Burrow" graded F/A (959 vs 6,095) and "$24 FAAB
 * for Aaron Jones" F/A in an 18-team guillotine league with 4 FLEX + 1 SUPER_FLEX starters and 8-man
 * rosters: the roster setup, the roster size and the FAAB traded all matter; FAAB buys the chopped teams'
 * players; with five starters, points matter more than positions. His two decisions:
 *
 *   1. A PLAYER is worth his projected points above the free agent who could fill the same starting slot
 *      in THIS league's lineup, over the weeks a team can expect to survive. "The free agent" is the one
 *      still on the wire once every live team has claimed one (`slotReplacement`).
 *   2. FAAB is worth its PURCHASING POWER: its share of the FAAB the live teams still hold, times the
 *      value of the players above that level on the wire now and of those the remaining chops will
 *      release — each counted only for the weeks left after he can be added.
 *
 * What the market grade got wrong, measured that day (production, read-only):
 *   - it priced the lineup as a 2-QB superflex league because any SUPER_FLEX slot picks that board, but
 *     FLEX cannot hold a quarterback, so a team here starts ONE: Burrow 6,139 on that board, 2,436 on the
 *     1-QB board;
 *   - FAAB was `amount / budget × 1800` ($75 of $200 = 675), the same in a guillotine as anywhere;
 *   - the five starters, the eight-man rosters and the survival horizon changed no number.
 *
 * ── THE SURVIVAL CURVE ─────────────────────────────────────────────────────────────────────────────────
 * One team is chopped per week. With T teams alive and an even chance for each, a live team is still
 * alive after week j with probability (T − j) / T, so it expects W(0) = Σ_{j=1..C} (T − j)/T more weeks —
 * (T − 1)/2 when the season outlasts the field (`lib/trade-intel/guillotine.ts` `guillotineHorizon`).
 * C is the chops left: one fewer than the teams alive, and never more than the regular-season weeks left
 * (`weeksLeft`). A player released by the k-th chop is first usable in week k + 1, so he is worth
 * W(k) = Σ_{j=k+1..C} (T − j)/T weeks to whoever buys him. Equal odds is a stated assumption: a team well
 * clear of the chop line survives longer than this and one sitting on it does not.
 *
 * ── NBA ────────────────────────────────────────────────────────────────────────────────────────────────
 * The same model, with three inputs that are NOT the NFL's (`./guillotineContext.ts` loads them):
 *   - WEEKS LEFT come from the NBA period calendar the guillotine engine itself chops on — seven Eastern
 *     days from the recorded opener (`lib/season-week/dailySportSeasonStarts.ts`), 24 regular-season weeks
 *     (`lib/guillotine/sportConfig.ts`) — counting the week in progress, as the NFL's projections do.
 *   - The board is the NBA points board (`./sportPointsContext.ts`), scored per GAME on the league's rules.
 *     A guillotine chops on the WEEK, and a team plays three or four games in one, so every player's line
 *     is put on the week first: per game × the games a team has left ÷ the weeks left (`gamesPerWeek`).
 *     One multiplier on every player — it sizes the numbers, it cannot move the letter.
 *   - A free agent sets a replacement level only on MIN_SAMPLE_GAMES (10) games, not three: three NBA
 *     games is one week, which is the NFL's bar in weeks, not in evidence.
 * Everything on a guillotine board below is therefore points per scoring WEEK, whatever the field is
 * called (`perGame`): for the NFL one game is one week.
 */

import type { TradeAssetInput } from '@/lib/trade-value-console/types'
import { gradeTrade, type TradeGradeLine, type TradeGradeView } from './tradeGrade'
import { indexBoard, meetsSampleBar, MIN_SAMPLE_GAMES, resolveBoardPlayer, type BoardPlayer } from './sportPointsValue'

/** Sports whose guillotine trades are graded here. Every other sport's guillotine stays on its own grade. */
export type GuillotineTradeSport = 'NFL' | 'NBA'

export function guillotineTradeSport(sport: string | null | undefined): GuillotineTradeSport | null {
  const s = String(sport ?? '').trim().toUpperCase()
  return s === 'NFL' || s === 'NBA' ? s : null
}

/** An NFL or NBA guillotine league — graded here, never on the market chart. Not `survivor_guillotine`: no trades. */
export function isGuillotineTradeLeague(args: { sport: string | null | undefined; leagueType: string | null | undefined; leagueVariant?: string | null }): boolean {
  if (!guillotineTradeSport(args.sport)) return false
  return String(args.leagueType ?? '').trim().toLowerCase() === 'guillotine' || String(args.leagueVariant ?? '').trim().toLowerCase() === 'guillotine'
}

/** A grade taken on the guillotine basis: every priced line came from it. */
export function isGuillotineBasisGrade(grade: { lines?: ReadonlyArray<{ valueSource?: string | null }> | null } | null | undefined): boolean {
  const lines = grade?.lines ?? []
  return lines.length > 0 && lines.every((l) => l.valueSource === 'guillotine_points' || l.valueSource === 'guillotine_faab')
}

/** One starting slot of the league's lineup and the positions it takes. */
export type GuillotineSeat = { slot: string; eligible: readonly string[] }

/** A free agent good enough to set a slot's replacement level must have played this many games (NFL). */
export const MIN_REPLACEMENT_GAMES = 3

/** The replacement-level games bar per sport: NFL three games (three weeks), NBA the points grade's ten. */
export function minReplacementGamesFor(sport: GuillotineTradeSport): number {
  return sport === 'NBA' ? MIN_SAMPLE_GAMES : MIN_REPLACEMENT_GAMES
}

export type GuillotineRoster = {
  /** Board ids of the players on it. */
  players: readonly string[]
  /** FAAB left; null when the provider does not say. */
  faab: number | null
}

export type GuillotineContext = {
  /** Absent means NFL (every context built before NBA was graded here). */
  sport?: GuillotineTradeSport
  /** Points per scoring WEEK, in `perGame` (see the header). */
  board: readonly BoardPlayer[]
  seats: readonly GuillotineSeat[]
  /** Best free agent each starting slot could take, by slot token. */
  replacementBySlot: ReadonlyMap<string, { name: string; perGame: number }>
  teamsAlive: number
  startingTeams: number
  /** Regular-season weeks left to play, the week in progress included (NFL projections; NBA period calendar). */
  weeksLeft: number
  /** Games a team plays in a scoring week, when that is not one (NBA); the board is already scaled by it. */
  gamesPerWeek?: number | null
  /** Games a free agent needs behind him to set a replacement level (`minReplacementGamesFor`). */
  minReplacementGames?: number
  /** W(k) for k = 0..C — see the header. */
  survival: readonly number[]
  /** FAAB the live teams hold between them. */
  liveFaab: number
  /** Board points the remaining chops will release, each player counted for the weeks after his release. */
  releaseValue: number
  /** Board points the wire holds now above the free level (`wireValue`). */
  wireValue: number
  /** Lineup label for the basis ("4 FLEX, 1 SUPER_FLEX"). */
  lineupLabel: string
}

const round1 = (n: number) => Math.round(n * 10) / 10
const pos = (p: string | null | undefined) => String(p ?? '').trim().toUpperCase()

/** W(k) for k = 0..C. */
export function survivalCurve(teamsAlive: number, weeksLeft: number): number[] {
  const t = Math.max(0, Math.floor(teamsAlive))
  const chops = Math.max(0, Math.min(t - 1, Math.floor(weeksLeft)))
  const alive = (j: number) => (t - j) / t
  const out: number[] = []
  for (let k = 0; k <= chops; k++) {
    let w = 0
    for (let j = k + 1; j <= chops; j++) w += alive(j)
    out.push(w)
  }
  return out
}

/**
 * The free agent each starting slot can count on: the one LEFT after every live team has claimed one.
 *
 * 🛑 NOT THE BEST FREE AGENT. In a guillotine the wire is where the chopped rosters went, and only one team
 * wins each of them — at a FAAB price. Guillotine League 26 (1), 2026-10-11: Jalen Coker 17.4 a week, then
 * Jaxson Dart, C.J. Stroud, Deshaun Watson, Josh Jacobs… a dozen startable players. Measured against the
 * best of them, Burrow was 2 points a week above "free" and every player below Coker worth nothing — as if
 * all fourteen teams could add Coker at once. What a team can add without outbidding the league is the
 * player still there once each live team has taken one, so `depth` is the number of live teams. The wire
 * above that level is what FAAB buys (`wireValue`).
 */
export function slotReplacement(
  board: readonly BoardPlayer[],
  rostered: ReadonlySet<string>,
  seats: readonly GuillotineSeat[],
  depth: number,
  minGames: number = MIN_REPLACEMENT_GAMES,
): Map<string, { name: string; perGame: number }> {
  const out = new Map<string, { name: string; perGame: number }>()
  const skip = Math.max(0, Math.floor(depth))
  for (const seat of seats) {
    if (out.has(seat.slot)) continue
    const eligible = new Set(seat.eligible.map(pos))
    const free = board
      .filter((p) => !rostered.has(p.id) && eligible.has(pos(p.position)))
      .filter((p) => p.sampleGames == null || p.sampleGames >= minGames)
      .sort((a, b) => b.perGame - a.perGame)
    // A wire too thin for every team to take one leaves nothing free: the level is zero.
    const left = free[skip]
    out.set(seat.slot, left ? { name: left.name, perGame: left.perGame } : { name: 'nobody (the wire is empty)', perGame: 0 })
  }
  return out
}

/**
 * What the wire holds NOW above the free level: each free agent's points over replacement, for every week a
 * team can expect to survive (W(0)). FAAB buys these today, as it buys the chops' releases later.
 */
export function wireValue(args: {
  board: readonly BoardPlayer[]
  rostered: ReadonlySet<string>
  seats: readonly GuillotineSeat[]
  replacementBySlot: ReadonlyMap<string, { perGame: number }>
  survival: readonly number[]
  minGames?: number
}): number {
  const weeks = args.survival[0] ?? 0
  const minGames = args.minGames ?? MIN_REPLACEMENT_GAMES
  let total = 0
  for (const p of args.board) {
    if (args.rostered.has(p.id)) continue
    if (p.sampleGames != null && p.sampleGames < minGames) continue
    total += pointsOverReplacement(p, args.seats, args.replacementBySlot) * weeks
  }
  return total
}

/**
 * Points a week above the free agent who would take his place, in the slot where he adds the most. A
 * position no starting slot takes (a kicker in a FLEX-only lineup) is worth nothing here: he never starts.
 */
export function pointsOverReplacement(
  player: Pick<BoardPlayer, 'position' | 'perGame'>,
  seats: readonly GuillotineSeat[],
  replacementBySlot: ReadonlyMap<string, { perGame: number }>,
): number {
  const p = pos(player.position)
  let lowest: number | null = null
  for (const seat of seats) {
    if (!seat.eligible.some((e) => pos(e) === p)) continue
    const r = replacementBySlot.get(seat.slot)?.perGame ?? 0
    if (lowest == null || r < lowest) lowest = r
  }
  if (lowest == null) return 0
  return Math.max(0, player.perGame - lowest)
}

/** A roster's best legal lineup, in projected points a week: the most restrictive slots filled first. */
export function lineupPoints(players: readonly Pick<BoardPlayer, 'id' | 'position' | 'perGame'>[], seats: readonly GuillotineSeat[]): number {
  const order = [...seats].sort((a, b) => a.eligible.length - b.eligible.length)
  const used = new Set<string>()
  let total = 0
  for (const seat of order) {
    const eligible = new Set(seat.eligible.map(pos))
    let best: (typeof players)[number] | null = null
    for (const p of players) {
      if (used.has(p.id) || !eligible.has(pos(p.position))) continue
      if (!best || p.perGame > best.perGame) best = p
    }
    if (best) {
      used.add(best.id)
      total += best.perGame
    }
  }
  return total
}

/**
 * What the remaining chops will release: the weakest live roster (by its best lineup) goes first, then
 * the next; the strongest is never chopped. Each released player counts his points over replacement for
 * the weeks after his release (W(k)).
 */
export function releaseValue(args: {
  rosters: readonly GuillotineRoster[]
  board: ReadonlyMap<string, BoardPlayer>
  seats: readonly GuillotineSeat[]
  replacementBySlot: ReadonlyMap<string, { perGame: number }>
  survival: readonly number[]
}): number {
  const ranked = args.rosters
    .map((r) => {
      const players = r.players.map((id) => args.board.get(id)).filter((p): p is BoardPlayer => Boolean(p))
      return { players, strength: lineupPoints(players, args.seats) }
    })
    .sort((a, b) => a.strength - b.strength)
  const chops = args.survival.length - 1
  let total = 0
  for (let k = 1; k <= chops && k <= ranked.length - 1; k++) {
    const weeks = args.survival[k] ?? 0
    if (weeks <= 0) continue
    for (const p of ranked[k - 1]!.players) total += pointsOverReplacement(p, args.seats, args.replacementBySlot) * weeks
  }
  return total
}

/** FAAB's purchasing power: its share of the live teams' FAAB, times what the wire holds now and the chops will release. */
export function faabWorth(amount: number, ctx: Pick<GuillotineContext, 'liveFaab' | 'releaseValue' | 'wireValue'>): number | null {
  if (!(amount > 0)) return 0
  if (!(ctx.liveFaab > 0)) return null
  return (Math.min(amount, ctx.liveFaab) / ctx.liveFaab) * (ctx.wireValue + ctx.releaseValue)
}

export function guillotineBasis(ctx: GuillotineContext): string {
  const weeks = ctx.survival[0] ?? 0
  const perWeek =
    ctx.sport === 'NBA' && ctx.gamesPerWeek != null
      ? ` An NBA week is about ${round1(ctx.gamesPerWeek)} games a team (the games left over the ${ctx.weeksLeft} chop weeks left), so a player’s points a week are his points a game times that.`
      : ''
  return (
    `Guillotine value: projected points per week above the free agent a team can still add for the same starting slot ` +
    `in this league’s lineup (${ctx.lineupLabel}) once every live team has claimed one, scored on this league’s rules, ` +
    `over the ${round1(weeks)} weeks a team can expect to survive with ${ctx.teamsAlive} of ${ctx.startingTeams} teams left ` +
    `(an even chance of the chop each week). FAAB is worth its share of the $${Math.round(ctx.liveFaab).toLocaleString('en-US')} ` +
    `the live teams hold, times the players on the wire now and those the remaining chops will release, each counted for ` +
    `the weeks left after he can be added.` +
    perWeek
  )
}

/** Grade one deal in a guillotine league. `give` is what the graded side sends. */
export function gradeGuillotineDeal(args: {
  give: readonly TradeAssetInput[]
  get: readonly TradeAssetInput[]
  ctx: GuillotineContext
}): TradeGradeView {
  const { ctx } = args
  const basis = guillotineBasis(ctx)
  const weeks = ctx.survival[0] ?? 0
  if (!(weeks > 0)) {
    return { graded: false, reason: 'This guillotine league has no chop left to play, so there is nothing to grade this deal on.', basis }
  }
  const index = indexBoard(ctx.board)
  const price = (assets: readonly TradeAssetInput[], side: 'give' | 'get'): { lines: TradeGradeLine[]; total: number } | { withheld: string } => {
    const lines: TradeGradeLine[] = []
    let total = 0
    for (const asset of assets) {
      if (asset.kind === 'pick') return { withheld: 'Draft picks are not priced in a guillotine league — every roster is gone by next season. This deal is not graded.' }
      if (asset.kind === 'faab') {
        const value = faabWorth(asset.amount, ctx)
        if (value == null) return { withheld: 'No live team’s FAAB balance is on file, so FAAB in this deal cannot be priced. This deal is not graded.' }
        total += value
        lines.push({ side, name: `$${asset.amount} FAAB`, marketValue: round1(value), leagueValue: round1(value), source: 'guillotine-faab', valueSource: 'guillotine_faab', valueAsOf: null })
        continue
      }
      const found = resolveBoardPlayer({ playerId: asset.playerId ?? null, name: asset.name ?? null }, ctx.board, index)
      if (!found.ok) return { withheld: `${found.reason} This deal is not graded.` }
      // The NBA board carries thin early-season lines; as on the NBA points grade, a thin one is not a price.
      if (ctx.sport === 'NBA' && !meetsSampleBar(found.player)) {
        return {
          withheld: `${found.player.name}’s projection rests on ${found.player.sampleGames} game${found.player.sampleGames === 1 ? '' : 's'}, too few to price — grades start at ${MIN_SAMPLE_GAMES} games. This deal is not graded.`,
        }
      }
      const value = pointsOverReplacement(found.player, ctx.seats, ctx.replacementBySlot) * weeks
      total += value
      lines.push({ side, name: found.player.name, marketValue: round1(value), leagueValue: round1(value), source: 'guillotine-vorp', valueSource: 'guillotine_points', valueAsOf: null })
    }
    return { lines, total }
  }
  const give = price(args.give, 'give')
  if ('withheld' in give) return { graded: false, reason: give.withheld, basis }
  const get = price(args.get, 'get')
  if ('withheld' in get) return { graded: false, reason: get.withheld, basis }
  if (give.total <= 0 && get.total <= 0) {
    return {
      graded: false,
      reason: 'Nothing in this deal is projected above the free agents who could take its place in this lineup.',
      basis,
    }
  }
  // A side worth nothing over replacement is a real answer; a hundredth keeps it gradable (as the sport grades do).
  const FLOOR = 0.01
  return gradeTrade({
    giveValue: Math.max(give.total, FLOOR),
    getValue: Math.max(get.total, FLOOR),
    giveMarket: give.total,
    getMarket: get.total,
    unpriced: 0,
    giveCount: args.give.length,
    getCount: args.get.length,
    basis,
    scoringApplied: true,
    needApplied: false,
    needGap: null,
    lines: [...give.lines, ...get.lines],
    moves: [],
  })
}
