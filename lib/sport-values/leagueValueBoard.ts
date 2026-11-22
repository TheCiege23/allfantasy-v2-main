import 'server-only'

import { prisma } from '@/lib/prisma'
import type { SportPointsBaseResult, SportPointsLeague } from '@/lib/decision-os/trade/sportPointsContext'
import { isFantraxNbaCampusLeague, MIN_SAMPLE_GAMES, meetsSampleBar, priceBoardPlayer, type BoardPlayer, type PointsGradedSport, type SportPointsContext } from '@/lib/decision-os/trade/sportPointsValue'
import { MIN_AT_BATS, MIN_INNINGS } from '@/lib/decision-os/trade/mlbTeamGame'
import { isDynastyGradedSport, missingAgeAssumption, playerDynastyValue } from '@/lib/decision-os/trade/sportDynastyValue'
import { loadCachedLeagueBoardBase, type CachedBoardResult } from '@/lib/decision-os/value-os/leagueBoard'

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
 * Owner's order: NBA first, then MLB, then NHL and soccer, one sport at a time. MLB joined 2026-11-16:
 * its board is per TEAM game (a starter's line scaled to his share of starts) and its sample is at-bats
 * or innings, which `boardSample` reports in those units. NHL joined the same day: a goalie counts for
 * his share of team games (`nhlTeamGame.ts`), a skater for every game, and the sample is games.
 */
export const BOARD_VALUE_SPORTS: ReadonlySet<PointsGradedSport> = new Set(['NBA', 'MLB', 'NHL', 'NCAAB', 'SOCCER'])

export function isBoardValueSport(sport: string | null | undefined): sport is PointsGradedSport {
  return BOARD_VALUE_SPORTS.has(String(sport ?? '').trim().toUpperCase() as PointsGradedSport)
}

export type LeagueBoardRow = SportPointsLeague & { sport: string }

export type LeagueValueBoardDeps = {
  league: (leagueId: string) => Promise<LeagueBoardRow | null>
  base: (sport: PointsGradedSport, league: SportPointsLeague, options?: { projectionOnly: true }) => Promise<SportPointsBaseResult | CachedBoardResult>
}

export const defaultLeagueValueBoardDeps: LeagueValueBoardDeps = {
  league: (leagueId) =>
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { id: true, sport: true, platform: true, platformLeagueId: true, settings: true, leagueType: true, leagueSize: true, season: true, status: true },
    }) as Promise<LeagueBoardRow | null>,
  // Through Value OS's three-minute league board, the one the in-league trade grade reads too (2026-11-21).
  base: (sport, league, options) => loadCachedLeagueBoardBase({ sport, league, ...options }),
}

export type LeagueValueBoard =
  /** The league's sport is not valued on a board yet: the caller keeps its old path. */
  | { kind: 'not_board_sport' }
  /** A board sport whose board could not be built here — the reason is the board's own words. */
  | { kind: 'unavailable'; sport: PointsGradedSport; reason: string }
  | { kind: 'ok'; sport: PointsGradedSport; ctx: SportPointsContext; byId: ReadonlyMap<string, BoardPlayer>; servedFrom?: 'store' | 'live'; projectionOnly?: true }

/** The board for one league, or why not. Never throws. */
export async function loadLeagueValueBoard(
  leagueId: string,
  deps: Partial<LeagueValueBoardDeps> = {},
  options?: { projectionOnly: true },
): Promise<LeagueValueBoard> {
  const d = { ...defaultLeagueValueBoardDeps, ...deps }
  const league = await d.league(leagueId).catch(() => null)
  if (!league || !isBoardValueSport(league.sport)) return { kind: 'not_board_sport' }
  const sport = league.sport.trim().toUpperCase() as PointsGradedSport
  const projection = options?.projectionOnly && isFantraxNbaCampusLeague(sport, league) ? options : undefined
  const base = await (projection ? d.base(sport, league, projection) : d.base(sport, league)).catch(() => null)
  if (!base) return { kind: 'unavailable', sport, reason: 'The league’s value board could not be read just now.' }
  if (!base.ok) return { kind: 'unavailable', sport, reason: base.reason }
  const servedFrom = 'servedFrom' in base ? base.servedFrom : undefined
  return { kind: 'ok', sport, ctx: base.ctx, byId: new Map(base.ctx.board.map((p) => [p.id, p])), ...(servedFrom ? { servedFrom } : {}), ...projection }
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

/**
 * What a board value rests on, in the unit its sport's sample bar counts: games — or, in baseball,
 * at-bats or innings, because ten games of baseball is a hot weekend (`mlbTeamGame.ts`). `thin` is
 * under twice the bar the board prices from: 20 games, 200 at-bats, 60 innings.
 */
export type BoardSampleKind = 'games' | 'at_bats' | 'innings'
export type BoardSample = { kind: BoardSampleKind; count: number; thin: boolean }

const THIN_BELOW: Record<BoardSampleKind, number> = { games: 2 * MIN_SAMPLE_GAMES, at_bats: 2 * MIN_AT_BATS, innings: 2 * MIN_INNINGS }

export function boardSample(p: Pick<BoardPlayer, 'sampleGames' | 'sampleBar'>): BoardSample | null {
  const bar = p.sampleBar
  if (bar?.unit && bar.count != null && Number.isFinite(bar.count)) {
    return { kind: bar.unit, count: bar.count, thin: bar.count < THIN_BELOW[bar.unit] }
  }
  if (p.sampleGames != null && Number.isFinite(p.sampleGames)) {
    return { kind: 'games', count: p.sampleGames, thin: p.sampleGames < THIN_BELOW.games }
  }
  return null
}

/** "412 at-bats", "26 games" — English, for text the model reads. Surfaces build their own words. */
export function boardSampleText(s: BoardSample): string {
  const n = s.kind === 'innings' ? String(s.count) : String(Math.round(s.count))
  const unit = s.kind === 'games' ? 'game' : s.kind === 'at_bats' ? 'at-bat' : 'inning'
  return `${n} ${unit}${s.count === 1 ? '' : 's'}`
}

/**
 * "50 games left" — or, before a season's schedule is posted (MLB's offseason), "a full 162-game season,
 * schedule not posted yet": the board then prices the sport's standard season, and must not say it counted.
 */
export function boardGamesText(window: Pick<SportPointsContext['window'], 'gamesRemaining' | 'scheduleKnown'>): string {
  return window.scheduleKnown === false
    ? `a full ${window.gamesRemaining}-game season, schedule not posted yet`
    : `${window.gamesRemaining} games left`
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
  /** False when `gamesRemaining` is the sport's standard season because the schedule is not posted yet. */
  scheduleKnown: boolean
  seasonLabel: string
  sample: BoardSample | null
  baselineSeasonLabel: string | null
  completedTradeSample?: number
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
  if (board.projectionOnly) return { available: false, reason: 'This board contains NBA projections for the current season. Campus-to-Canton trade values require both divisions.' }
  const { ctx, sport } = board
  if (ctx.window.gamesRemaining <= 0) {
    return { available: false, reason: `The ${ctx.window.seasonLabel} regular season has no games left, so there is no rest-of-season value.` }
  }
  const price = priceBoardPlayer(asset, ctx, asset.playerId && board.byId.has(asset.playerId) ? board.byId : undefined)
  if (!price.ok) return { available: false, reason: price.reason }
  const age = ctx.dynasty?.ages.get(price.player.id) ?? null
  const classYear = ctx.dynasty?.classYears?.get(price.player.id)
  const dynastyValue =
    ctx.dynasty && isDynastyGradedSport(sport) && (sport !== 'NCAAB' || classYear != null)
      ? playerDynastyValue({ sport, player: price.player, age: sport === 'NCAAB' ? undefined : age ?? missingAgeAssumption(sport, price.player.position), collegeSeasons: classYear == null ? undefined : 5 - classYear, replacementPerGame: price.replacementPerGame, gamesRemaining: ctx.window.gamesRemaining })
      : null
  return {
    available: true,
    data: {
      sport,
      unit: boardUnit(ctx),
      perGame: price.player.perGame,
      replacementPerGame: price.replacementPerGame,
      replacementName: price.replacementName,
      completedTradeSample: price.player.tradeMarket?.trades ?? 0,
      value: price.value,
      gamesRemaining: ctx.window.gamesRemaining,
      scheduleKnown: ctx.window.scheduleKnown !== false,
      seasonLabel: ctx.window.seasonLabel,
      sample: boardSample(price.player),
      baselineSeasonLabel: ctx.window.baselineSeasonLabel ?? null,
      dynastyValue: dynastyValue != null && Number.isFinite(dynastyValue) ? dynastyValue : null,
      age,
    },
  }
}

/** Candidate identities come from the same scored population as the league's rankings. */
export function boardRateRows(board: Extract<LeagueValueBoard, { kind: 'ok' }>) {
  return board.ctx.board.map(p => ({ key: p.id, name: p.name, position: p.position, perGame: p.perGame, components: null }))
}
