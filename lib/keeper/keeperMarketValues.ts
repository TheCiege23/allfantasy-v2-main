import { getFantasyCalcValuesDbFirst } from '@/lib/fantasycalc-db'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { indexBoard, priceBoardPlayer, type SportPointsContext, type BoardPlayer } from '@/lib/decision-os/trade/sportPointsValue'
import { isBoardValueSport, loadLeagueValueBoard, type LeagueValueBoard, type LeagueValueBoardDeps } from '@/lib/sport-values/leagueValueBoard'

/**
 * Market ranks for a keeper league's players (1 = most valuable). Shared by the missed-deadline rule
 * (./missedDeadlineService), the keeper value report (the Keepers tab, ./keeperValueReport) and the
 * player card's keeper line (./keeperCardCost), so all of them price a player the same way.
 *
 *   NFL    — FantasyCalc's redraft overall rank, read DB-first (`getFantasyCalcValuesDbFirst`).
 *   NBA · MLB · NHL · NCAAB · SOCCER (`BOARD_VALUE_SPORTS`, one list for every surface) — only with
 *            `includeBoardSports`: his rank on the LEAGUE'S OWN value board (lib/sport-values/leagueValueBoard.ts),
 *            the board its trade grades, waiver screens and value answers read. The rank orders every board
 *            player by `priceBoardPlayer`'s rest-of-season value over replacement — the trade grade's own
 *            price, not a second model. DB-first: the board is Value OS's stored league board.
 *
 * `null` means "no market values for this league"; a lookup that returns null means "this player has no
 * market price" — and the caller then shows no value rather than a guess. On a board, a player at or below
 * replacement level (value 0: a free agent is as good) has no rank, and a season with no games left has no
 * board ranks at all (the board itself prices nothing then).
 *
 * 🛑 SLEEPER IDS ARE PER SPORT (NFL 1466 Kelce, NBA 1466 McGee). The FantasyCalc chart is NFL players, so it
 * is read for an NFL league only; a board sport's ids resolve on that sport's board only.
 *
 * The missed-deadline rule does NOT pass `includeBoardSports` (it runs inside the keeper lock's transaction,
 * and it writes keepers), so AF's automatic keeps stay NFL-only for now; what it keeps by is still this rank.
 */

export type MarketRankLookup = (player: { playerId: string; name: string | null | undefined; position: string | null | undefined }) => number | null

const keyOf = (name: string | null | undefined, position: string | null | undefined) =>
  `${normalizePlayerName(name)}|${String(position ?? '').trim().toUpperCase()}`

export type KeeperMarketRankOptions = {
  /** Rank a board sport's players on the league's own value board (the card and the Keepers tab). */
  includeBoardSports?: boolean
  /** Test seam for the board read. */
  boardDeps?: Partial<LeagueValueBoardDeps>
}

export async function loadKeeperMarketRanks(league: {
  id?: string | null
  sport?: string | null
  leagueSize?: number | null
  scoringPresetId?: string | null
  settings?: unknown
}, rosterCount: number, options: KeeperMarketRankOptions = {}): Promise<MarketRankLookup | null> {
  const sport = String(league.sport ?? 'NFL').trim().toUpperCase() || 'NFL'
  if (sport !== 'NFL') {
    if (!options.includeBoardSports || !league.id || !isBoardValueSport(sport)) return null
    const board = await loadLeagueValueBoard(league.id, options.boardDeps).catch(() => null)
    return board ? boardMarketRanks(board) : null
  }
  const settings = (league.settings as Record<string, unknown> | null) ?? {}
  const superflex = /superflex|\bsf\b|2qb/i.test(String(league.scoringPresetId ?? settings.scoring_preset_id ?? ''))
  const teams = league.leagueSize ?? rosterCount
  const chart = await getFantasyCalcValuesDbFirst({ isDynasty: false, numQbs: superflex ? 2 : 1, numTeams: Math.max(8, Math.min(16, teams)), ppr: 1 }).catch(() => [])
  if (!chart.length) return null
  const bySleeper = new Map<string, number>()
  const byName = new Map<string, number>()
  for (const p of chart) {
    if (p.player.sleeperId) bySleeper.set(String(p.player.sleeperId), p.overallRank)
    byName.set(keyOf(p.player.name, p.player.position), p.overallRank)
  }
  return (p) => bySleeper.get(p.playerId) ?? byName.get(keyOf(p.name, p.position)) ?? null
}

/**
 * Ranks on a league's value board. PURE given the board; exported for tests.
 *
 * Every board player is priced by `priceBoardPlayer` on his own board id (so a Fantrax league's provider-id
 * requirement does not hide the population), ordered by value, highest first; equal values share a rank.
 * A player is then found the way the card's board value finds him — his id (the league's roster id, a
 * Sleeper id of THIS sport, a Rolling Insights id), else his name — through the same `priceBoardPlayer`.
 */
export function boardMarketRanks(board: LeagueValueBoard): MarketRankLookup | null {
  if (board.kind !== 'ok' || board.projectionOnly) return null
  const { ctx } = board
  if (ctx.window.gamesRemaining <= 0) return null

  const population: SportPointsContext = { ...ctx, requireProviderId: false, rosterIndex: undefined }
  const ownIds = new Map<string, BoardPlayer>(ctx.board.map((p) => [p.id, p]))
  const priced: Array<{ id: string; value: number }> = []
  for (const p of ctx.board) {
    const price = priceBoardPlayer({ playerId: p.id }, population, ownIds)
    if (price.ok && Number.isFinite(price.value) && price.value > 0) priced.push({ id: price.player.id, value: price.value })
  }
  if (!priced.length) return null
  priced.sort((a, b) => b.value - a.value)
  const rankById = new Map<string, number>()
  priced.forEach((p, i) => {
    const prev = priced[i - 1]
    rankById.set(p.id, prev && prev.value === p.value ? rankById.get(prev.id)! : i + 1)
  })

  // As `boardPlayerValue` (the card's board value) resolves him: the board's own ids when his id is one,
  // else every alias the board knows (Sleeper ids of THIS sport, Rolling Insights ids), else his name.
  const aliases = indexBoard(ctx.board)
  return (p) => {
    const id = String(p.playerId ?? '').trim()
    const price = priceBoardPlayer({ playerId: id || null, name: p.name ?? null }, ctx, id && board.byId.has(id) ? board.byId : aliases)
    return price.ok ? rankById.get(price.player.id) ?? null : null
  }
}
