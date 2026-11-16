import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadSportPointsBase, type SportPointsBaseResult, type SportPointsLeague } from '@/lib/decision-os/trade/sportPointsContext'
import { meetsSampleBar, priceBoardPlayer, type BoardPlayer, type PointsGradedSport, type SportPointsContext } from '@/lib/decision-os/trade/sportPointsValue'
import { isDynastyGradedSport, playerDynastyValue } from '@/lib/decision-os/trade/sportDynastyValue'

/**
 * A league's own value board, for the surfaces that price a player OUTSIDE a trade (2026-11-16, re-score
 * item 12): Chimmy's value answer, the Waivers board, the FAAB plan and the player card.
 *
 * 🛑 THE SAME BOARD AS THE TRADE GRADE, NEVER A SECOND MODEL. `loadSportPointsBase` scores every player
 * under THIS league's rules — its points, or in a category league its categories — from AllFantasy's
 * season projection, and it is what `gradeSportPointsDeal` prices. A waiver add, a bid and a card value
 * read off the same numbers, so none of them can disagree with the Trade Center about a player.
 *
 * Why the waiver boards needed it: they priced these sports on AllFantasy's DEFAULT scoring
 * (`waiverSportBasis.ts`), because the projection engine's stat names do not match a league rulebook's.
 * The board already bridges them (`getDailySportNormalizer`), so a points league is scored by its own
 * rules and a category league by its own categories.
 *
 * Owner's order: NBA first, then MLB, then NHL and soccer, one sport at a time.
 */
export const BOARD_VALUE_SPORTS: ReadonlySet<PointsGradedSport> = new Set(['NBA'])

export function isBoardValueSport(sport: string | null | undefined): sport is PointsGradedSport {
  return BOARD_VALUE_SPORTS.has(String(sport ?? '').trim().toUpperCase() as PointsGradedSport)
}

export type LeagueBoardRow = SportPointsLeague & { sport: string }

export type LeagueValueBoardDeps = {
  league: (leagueId: string) => Promise<LeagueBoardRow | null>
  base: (sport: PointsGradedSport, league: SportPointsLeague) => Promise<SportPointsBaseResult>
}

export const defaultLeagueValueBoardDeps: LeagueValueBoardDeps = {
  league: (leagueId) =>
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, sport: true, platform: true, platformLeagueId: true, settings: true, leagueType: true, leagueSize: true, season: true, status: true },
    }) as Promise<LeagueBoardRow | null>,
  base: (sport, league) => loadSportPointsBase({ sport, league }),
}

export type LeagueValueBoard =
  /** The league's sport is not valued on a board yet: the caller keeps its old path. */
  | { kind: 'not_board_sport' }
  /** A board sport whose board could not be built here — the reason is the board's own words. */
  | { kind: 'unavailable'; sport: PointsGradedSport; reason: string }
  | { kind: 'ok'; sport: PointsGradedSport; ctx: SportPointsContext; byId: ReadonlyMap<string, BoardPlayer> }

/** The board for one league, or why not. Never throws. */
export async function loadLeagueValueBoard(
  leagueId: string,
  deps: Partial<LeagueValueBoardDeps> = {},
): Promise<LeagueValueBoard> {
  const d = { ...defaultLeagueValueBoardDeps, ...deps }
  const league = await d.league(leagueId).catch(() => null)
  if (!league || !isBoardValueSport(league.sport)) return { kind: 'not_board_sport' }
  const sport = league.sport.trim().toUpperCase() as PointsGradedSport
  const base = await d.base(sport, league).catch(() => null)
  if (!base) return { kind: 'unavailable', sport, reason: 'The league’s value board could not be read just now.' }
  if (!base.ok) return { kind: 'unavailable', sport, reason: base.reason }
  return { kind: 'ok', sport, ctx: base.ctx, byId: new Map(base.ctx.board.map((p) => [p.id, p])) }
}

/** What a board value measures, as a phrase: "fantasy points" or "category score". */
export function boardUnit(ctx: Pick<SportPointsContext, 'valueKind'>): 'fantasy points' | 'category score' {
  return ctx.valueKind === 'categories' ? 'category score' : 'fantasy points'
}

/**
 * A board player's per-game value, by projection key (`PlayerIdentityMap.id`, the key the season-rate
 * pool and the board share). `wire` asks for a free agent: one whose projection rests on too few games
 * is not offered — the grade's own sample bar. A rostered player is priced on whatever sample he has,
 * because the lineup he sits in is real either way.
 */
export function boardPerGame(board: Extract<LeagueValueBoard, { kind: 'ok' }>, key: string, use: 'wire' | 'roster'): number | null {
  const p = board.byId.get(key)
  if (!p || !Number.isFinite(p.perGame)) return null
  if (use === 'wire' && !meetsSampleBar(p)) return null
  return p.perGame
}

/** One player on a league's board, as a surface shows him: the trade grade's own price, plus dynasty. */
export type BoardPlayerValue = {
  sport: string
  unit: 'fantasy points' | 'category score'
  perGame: number
  replacementPerGame: number
  replacementName: string
  value: number
  gamesRemaining: number
  seasonLabel: string
  sampleGames: number | null
  baselineSeasonLabel: string | null
  dynastyValue: number | null
  age: number | null
}

/**
 * One player's value on a league's board, or why not — in `priceBoardPlayer`'s words, which are the
 * trade grade's. A dynasty league adds the aged multi-season value the dynasty grade reads.
 */
export function boardPlayerValue(
  board: LeagueValueBoard,
  asset: { playerId?: string | null; rosterPlayerId?: string | null; name?: string | null },
): { available: true; data: BoardPlayerValue } | { available: false; reason: string } {
  if (board.kind === 'not_board_sport') return { available: false, reason: 'This sport is not valued on a league board yet.' }
  if (board.kind === 'unavailable') return { available: false, reason: board.reason }
  const { ctx, sport } = board
  if (ctx.window.gamesRemaining <= 0) {
    return { available: false, reason: `The ${ctx.window.seasonLabel} regular season has no games left, so there is no rest-of-season value.` }
  }
  const price = priceBoardPlayer(asset, ctx)
  if (!price.ok) return { available: false, reason: price.reason }
  const age = ctx.dynasty?.ages.get(price.player.id) ?? null
  const dynastyValue =
    ctx.dynasty && isDynastyGradedSport(sport)
      ? playerDynastyValue({ sport, player: price.player, age: age ?? undefined, replacementPerGame: price.replacementPerGame, gamesRemaining: ctx.window.gamesRemaining })
      : null
  return {
    available: true,
    data: {
      sport,
      unit: boardUnit(ctx),
      perGame: price.player.perGame,
      replacementPerGame: price.replacementPerGame,
      replacementName: price.replacementName,
      value: price.value,
      gamesRemaining: ctx.window.gamesRemaining,
      seasonLabel: ctx.window.seasonLabel,
      sampleGames: price.player.sampleGames,
      baselineSeasonLabel: ctx.window.baselineSeasonLabel ?? null,
      dynastyValue: dynastyValue != null && Number.isFinite(dynastyValue) ? dynastyValue : null,
      age,
    },
  }
}
