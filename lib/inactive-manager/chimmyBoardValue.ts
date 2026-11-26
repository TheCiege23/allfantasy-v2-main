/**
 * CHIMMY PRICES NBA, COLLEGE BASKETBALL AND NHL DEALS ON THE LEAGUE'S VALUE BOARD.
 *
 * The Trade Center grades these sports on points over replacement (lib/decision-os/trade/sportPointsValue.ts,
 * read through lib/sport-values/leagueValueBoard.ts). Chimmy used to price them on a different engine — a
 * season projection on the redraft chart — so it could decline a deal the trade screen calls fair, and it
 * could not price anyone that engine had not projected. This prices Chimmy's deals on the SAME board, so
 * Chimmy and the grade agree about a player.
 *
 * Every player gets a value:
 *
 *   projection   on the board with enough games: exactly the grade's value.
 *   thin_sample  on the board with fewer games than the grade needs: his rate, pulled toward the best free
 *                agent at his position by how few games there are (none = a free agent, 10 = his own rate).
 *   replacement  we know who he is (he is in the player registry) but he has no games to price: he is
 *                worth what the best free agent at his position is worth — nothing over replacement.
 *   none         an id we cannot place at all. Chimmy never GIVES such a player (it could be anyone);
 *                getting him counts as nothing.
 *
 * In a dynasty league the value is the grade's five-season value, and a draft pick is priced on the same
 * points-based rookie curve the grade uses. Outside a dynasty league the screen refuses a pick (a redraft
 * league has no next season to use it in), and this returns a blocked snapshot so Chimmy declines too.
 * A deal with FAAB is left to the older pricing — never two units in one deal.
 *
 * Pure: the loader in ./chimmyBoardPricing.ts reads the board and the registry.
 */
import type { AssetValueSnapshot, TradeValueSnapshot } from '@/lib/trade-value/types'
import {
  MIN_SAMPLE_GAMES,
  indexBoard,
  meetsSampleBar,
  resolveBoardPlayer,
  type BoardPlayer,
  type SportPointsContext,
} from '@/lib/decision-os/trade/sportPointsValue'
import {
  isDynastyGradedSport,
  missingAgeAssumption,
  pickDynastyValue,
  playerDynastyValue,
  youngPlayerPool,
} from '@/lib/decision-os/trade/sportDynastyValue'

/** A replaceable player still counts for a sliver, so "free agent level" is a price, not a missing one. */
export const BOARD_VALUE_FLOOR = 0.01

export type BoardValueBasis = 'projection' | 'thin_sample' | 'replacement' | 'none'

/** A deal's asset, as Chimmy's pricing step already builds it (lib/trade-value/captureSnapshot input). */
export type ChimmyDealAsset = {
  fromRosterId: string
  toRosterId: string
  assetType: string
  playerId?: string | null
  playerName?: string | null
  pickSeason?: number | null
  pickRound?: number | null
}

/**
 * What the registry says about a roster id the board did not resolve: the board alias to try instead
 * (an NHL TheSportsDB id's Rolling Insights number), and whether the player is known at all.
 */
export type RosterIdentity = { alias?: string | null; name?: string | null; position?: string | null }

export type PricedBoardAsset = {
  value: number
  basis: BoardValueBasis
  position: string | null
  name: string | null
}

/** The best free agent's rate at a position, or — with none at that position — the highest anywhere (the cautious choice). */
function replacementFor(ctx: SportPointsContext, position: string): number | null {
  const own = ctx.replacementByPosition.get(position.trim().toUpperCase())
  if (own) return own.perGame
  let best: number | null = null
  for (const r of ctx.replacementByPosition.values()) if (best == null || r.perGame > best) best = r.perGame
  return best
}

/** How much of a thin sample to believe: 0 games none of it, the grade's games bar all of it. */
export function sampleWeight(p: Pick<BoardPlayer, 'sampleGames' | 'sampleBar'>): number {
  if (meetsSampleBar(p)) return 1
  // A baseball bar counts at-bats or innings, not games: below it, believe half the rate.
  if (p.sampleBar) return 0.5
  const games = p.sampleGames ?? 0
  return Math.max(0, Math.min(1, games / MIN_SAMPLE_GAMES))
}

function playerValue(ctx: SportPointsContext, player: BoardPlayer): { value: number; basis: BoardValueBasis } | null {
  const replacement = replacementFor(ctx, player.position)
  if (replacement == null) return null
  const w = sampleWeight(player)
  const perGame = replacement + (player.perGame - replacement) * w
  const basis: BoardValueBasis = w >= 1 ? 'projection' : 'thin_sample'
  const sport = ctx.sport
  if (ctx.dynasty && isDynastyGradedSport(sport)) {
    const college = sport === 'NCAAB'
    const year = college ? ctx.dynasty.classYears?.get(player.id) : undefined
    const collegeSeasons = college && year != null && Number.isInteger(year) && year >= 1 && year <= 4 ? 5 - year : college ? 1 : undefined
    const age = college ? undefined : ctx.dynasty.ages.get(player.id) ?? missingAgeAssumption(sport, player.position)
    return {
      value: playerDynastyValue({ sport, player: { ...player, perGame }, age, collegeSeasons, replacementPerGame: replacement, gamesRemaining: ctx.window.gamesRemaining }),
      basis,
    }
  }
  return {
    value: Math.max(0, perGame - replacement) * Math.max(0, ctx.window.gamesRemaining) * (1 + (player.tradeMarket?.percent ?? 0) / 100),
    basis,
  }
}

/**
 * Price one deal on the board, as the value snapshot Chimmy's decision reads — or null when the deal is
 * not one this board prices (a pick outside a dynasty league, FAAB, a specialty asset), so the caller
 * keeps its older pricing for the whole deal.
 */
export function priceDealOnBoard(args: {
  ctx: SportPointsContext
  assets: readonly ChimmyDealAsset[]
  /** Registry facts for roster ids the board does not carry directly. */
  identities: ReadonlyMap<string, RosterIdentity>
  proposerRosterId: string
  receiverRosterId: string
}): TradeValueSnapshot | null {
  const { ctx } = args
  const dynasty = ctx.dynasty && isDynastyGradedSport(ctx.sport) ? ctx.dynasty : null
  const index = indexBoard(ctx.board)
  let pool: number[] | null = null

  const priced: Array<AssetValueSnapshot> = []
  for (const a of args.assets) {
    let p: PricedBoardAsset
    if (a.assetType === 'draft_pick') {
      // Outside a dynasty league the screen refuses a pick (no next season to use it in): so does Chimmy.
      if (!dynasty || !isDynastyGradedSport(ctx.sport)) return blockedSnapshot()
      if (a.pickSeason == null || a.pickRound == null) return null
      pool ??= youngPlayerPool({ ...ctx, sport: ctx.sport }, dynasty)
      const pick = pickDynastyValue({ sport: ctx.sport, pick: { kind: 'pick', year: a.pickSeason, round: a.pickRound }, pool, teams: ctx.teams, nextDraftYear: dynasty.nextDraftYear })
      if (!pick.ok) return null
      p = { value: pick.value, basis: 'projection', position: null, name: null }
    } else if (a.assetType === 'player' && a.playerId) {
      p = pricePlayer(ctx, index, a.playerId, args.identities.get(a.playerId))
    } else {
      return null
    }
    const isPick = a.assetType === 'draft_pick'
    const value = p.basis === 'none' ? 0 : Math.max(p.value, BOARD_VALUE_FLOOR)
    priced.push({
      kind: isPick ? 'draft_pick' : 'player',
      fromRosterId: a.fromRosterId,
      toRosterId: a.toRosterId,
      playerId: a.playerId ?? null,
      playerName: a.playerName ?? p.name,
      position: p.position,
      pickSeason: a.pickSeason ?? null,
      pickRound: a.pickRound ?? null,
      internalValue: value,
      valuationBasis: p.basis === 'none' ? 'none' : 'projection',
      boardBasis: p.basis,
    } as unknown as AssetValueSnapshot)
  }

  const side = (rosterId: string) => ({ rosterId, assets: priced.filter((x) => x.fromRosterId === rosterId) })
  return {
    sides: [side(args.proposerRosterId), side(args.receiverRosterId)],
    grade: null,
    coverage: { status: 'complete', items: [] },
    source: `${ctx.sport.toLowerCase()}-board`,
  } as unknown as TradeValueSnapshot
}

/** A deal the screen will not grade: Chimmy's decision reads `blocked` as "cannot value", and declines. */
function blockedSnapshot(): TradeValueSnapshot {
  return { sides: [], grade: null, coverage: { status: 'blocked', items: [] } } as unknown as TradeValueSnapshot
}

/** One player on the board, by his roster id or the registry's alias for it. */
export function pricePlayer(
  ctx: SportPointsContext,
  index: ReadonlyMap<string, BoardPlayer>,
  rosterId: string,
  identity: RosterIdentity | undefined,
): PricedBoardAsset {
  for (const id of [rosterId, identity?.alias].filter((v): v is string => Boolean(v))) {
    const found = resolveBoardPlayer({ playerId: id }, ctx.board, index)
    if (!found.ok) continue
    const v = playerValue(ctx, found.player)
    if (v) return { ...v, position: found.player.position, name: found.player.name }
  }
  // Known to the registry but not on the board: no games to price him on. A free agent's worth.
  if (identity) return { value: 0, basis: 'replacement', position: identity.position ?? null, name: identity.name ?? null }
  return { value: 0, basis: 'none', position: null, name: null }
}

/** A player's rate per game for the waiver planner: the board's, pulled toward replacement when thin. */
export function boardRateFor(
  ctx: SportPointsContext,
  index: ReadonlyMap<string, BoardPlayer>,
  ids: readonly (string | null | undefined)[],
): number | null {
  for (const id of ids) {
    if (!id) continue
    const found = resolveBoardPlayer({ playerId: id }, ctx.board, index)
    if (!found.ok) continue
    const replacement = replacementFor(ctx, found.player.position)
    if (replacement == null) return found.player.perGame
    return replacement + (found.player.perGame - replacement) * sampleWeight(found.player)
  }
  return null
}
