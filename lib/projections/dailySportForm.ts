/**
 * AF projection and position rank for the DAILY pro sports (NBA, NHL, MLB) — the pure half.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 * NFL players carry a weekly vendor projection (`fantasy_projections`) re-scored per league. Nothing
 * like it exists for these three sports: `AFProjectionSnapshot` holds a per-game SEASON rate in the
 * provider's vocabulary, which league rulebooks do not match (see waiverSportBasis.ts), and no
 * contract endpoint serves a forward projection. So the waiver and lineup screens showed "-".
 *
 * What we DO hold, complete and refreshed nightly, is every regular-season game line in
 * `player_game_stats`. This builds, per player, the summed stat line of his season and of his most
 * recent games — normalized by `getDailySportNormalizer`, the same normalizer the weekly matchup
 * sync scores with. A league then scores those sums with `buildLeagueStatScorer`, the same scorer
 * the matchup uses. There is ONE implementation of each rule; this file owns neither.
 *
 * ── 🛑 IT IS A RECENT-FORM NUMBER, NOT A VENDOR PROJECTION, AND IS LABELLED SO ──────────────────
 *   projection = recent per-game points (league scoring)
 *              × his pro team's games in the scoring period (week, or today in a daily league)
 *              × availability (0 when ruled out or inactive)
 *              × participation (MLB pitchers only: a starter does not pitch every team game)
 * It knows nothing about a coming role change. Every surface prints `AF_FORM_PROJECTION_LABEL`.
 *
 * ── WHY SUMS, NOT PER-GAME POINTS ──────────────────────────────────────────────────────────────
 * Scoring is per league, so points cannot be stored. Summed normalized lines can: every category
 * the daily scorers apply is linear in the summed line, and the per-game derived ones (double-
 * double, quality start, NHL rate bonuses) are already resolved per game by the normalizer before
 * anything sums — exactly what the weekly matchup scores. Scoring a sum here IS scoring the games.
 */

import { aggregateWeeklyStats, type NormalizedGameStats } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveStoredSeasonType } from '@/lib/sports-data/riSeasonType'
import { isRuledOut } from '@/lib/core-app/injuryStatus'

export const DAILY_FORM_SPORTS: readonly string[] = ['NBA', 'NHL', 'MLB']

export function isDailyFormSport(sport: string | null | undefined): boolean {
  return DAILY_FORM_SPORTS.includes(String(sport ?? '').trim().toUpperCase())
}

/** Games that make up "recent form". A baseball line is noisier per game, so it looks further back. */
export const RECENT_FORM_GAMES: Readonly<Record<string, number>> = { NBA: 10, NHL: 10, MLB: 15 }

/** Below this many recent games there is no per-game rate worth multiplying out. */
export const MIN_RECENT_FORM_GAMES = 2

export { AF_FORM_PROJECTION_LABEL, AF_FORM_PROJECTION_SOURCE } from './dailySportFormLabels'

export type FormPlayer = {
  /** Rank group: the position he is ranked within ("C", "SP", "OF"). Null = not ranked. */
  pos: string | null
  /** Team code of his most recent game — a fallback when the roster row carries no team. */
  team: string | null
  /** Regular-season games this season, and their summed normalized line. */
  sg: number
  ss: Record<string, number>
  /** The most recent `RECENT_FORM_GAMES` of those games, summed. */
  rg: number
  rs: Record<string, number>
  /** MLB pitchers: appearances per team game this season, capped at 1. Null = plays every team game. */
  part: number | null
}

export type DailySportFormBlob = {
  v: 1
  sport: string
  season: number
  computedAt: string
  recentGames: number
  players: Record<string, FormPlayer>
}

export type GameLogRow = {
  playerId: string
  gameId: string
  providerGameId: string | null
  gameDate: Date | null
  season: number
  team: string | null
  normalizedStatMap: unknown
}

type Normalizer = (raw: unknown) => NormalizedGameStats

function mapRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** An MLB two-way line is two rows (`<game>:batting`, `<game>:pitching`) of ONE game. */
export function gameKeyOf(row: Pick<GameLogRow, 'gameId' | 'providerGameId'>): string {
  return row.providerGameId || String(row.gameId ?? '').split(':')[0]
}

const MLB_OUTFIELD = new Set(['LF', 'CF', 'RF', 'OF'])

/**
 * The position a player is ranked within.
 *
 * Read from `PlayerIdentityMap.position` first: a game line carries the spot he played THAT day,
 * which for baseball is noise ("PH-LF", "PR-2B"). Baseball pitchers are all "P" there, so starter
 * vs reliever comes from the game lines themselves — the vendor marks a pitching appearance "S"
 * (started) or "R" (relieved). Outfield corners fold into OF, the slot leagues roster them in.
 */
export function rankPositionFor(
  sport: string,
  identityPosition: string | null | undefined,
  facts: { pitchingApps: number; starts: number; lastGamePosition: string | null },
): string | null {
  const s = sport.toUpperCase()
  const raw = String(identityPosition ?? '').trim().toUpperCase()
  if (s === 'MLB') {
    const pitcher = raw === 'P' || raw === 'SP' || raw === 'RP' || (!raw && facts.pitchingApps > 0)
    if (pitcher) return facts.pitchingApps > 0 && facts.starts / facts.pitchingApps >= 0.5 ? 'SP' : 'RP'
    if (raw === 'TWP') return 'UT'
    const pos = raw || String(facts.lastGamePosition ?? '').toUpperCase().replace(/^(PH|PR)-?/, '').split('-')[0]
    if (!pos || pos === 'PH' || pos === 'PR') return null
    return MLB_OUTFIELD.has(pos) ? 'OF' : pos
  }
  return raw || String(facts.lastGamePosition ?? '').trim().toUpperCase() || null
}

function addInto(into: Record<string, number>, from: Record<string, number>): void {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v
}

/**
 * Season and recent-form lines for every player with a regular-season game this season.
 *
 * Preseason and postseason are excluded: neither counts toward a season's fantasy points, and a
 * playoff line would make a player who is done for the year look in form.
 */
export function buildDailySportForm(args: {
  sport: string
  season: number
  rows: readonly GameLogRow[]
  identityPositions: ReadonlyMap<string, string | null>
  normalizer: Normalizer
  computedAt: Date
}): DailySportFormBlob {
  const sport = args.sport.toUpperCase()
  const recentGames = RECENT_FORM_GAMES[sport] ?? 10

  type Game = { key: string; day: number; team: string | null; rows: unknown[]; pitched: boolean; started: boolean; position: string | null }
  const byPlayer = new Map<string, Map<string, Game>>()
  /** Team code -> its distinct regular-season game keys, for the MLB pitcher participation rate. */
  const teamGames = new Map<string, Set<string>>()

  for (const row of args.rows) {
    const seasonType = resolveStoredSeasonType({
      normalizedStatMap: row.normalizedStatMap,
      sport,
      season: row.season,
      gameDate: row.gameDate,
    })
    if (seasonType === 'pre' || seasonType === 'post') continue
    const key = gameKeyOf(row)
    if (!key) continue
    const team = row.team ? row.team.trim().toUpperCase() : null
    if (team) {
      const set = teamGames.get(team) ?? new Set<string>()
      set.add(key)
      teamGames.set(team, set)
    }
    const games = byPlayer.get(row.playerId) ?? new Map<string, Game>()
    const map = mapRecord(row.normalizedStatMap)
    const game = games.get(key) ?? {
      key,
      day: row.gameDate ? row.gameDate.getTime() : 0,
      team,
      rows: [],
      pitched: false,
      started: false,
      position: null,
    }
    game.rows.push(row.normalizedStatMap)
    if (map.group === 'pitching') {
      game.pitched = true
      if (String(map.position ?? '').toUpperCase() === 'S') game.started = true
    } else if (typeof map.position === 'string' && map.position) {
      game.position = map.position
    }
    games.set(key, game)
    byPlayer.set(row.playerId, games)
  }

  const players: Record<string, FormPlayer> = {}
  for (const [playerId, games] of byPlayer) {
    const scored: Array<Game & { stats: Record<string, number> }> = []
    for (const g of games.values()) {
      const agg = aggregateWeeklyStats(g.rows, args.normalizer)
      if (agg.gamesCounted === 0 || Object.keys(agg.stats).length === 0) continue
      scored.push({ ...g, stats: agg.stats })
    }
    if (scored.length === 0) continue
    scored.sort((a, b) => b.day - a.day || b.key.localeCompare(a.key))

    const ss: Record<string, number> = {}
    const rs: Record<string, number> = {}
    scored.forEach((g, i) => {
      addInto(ss, g.stats)
      if (i < recentGames) addInto(rs, g.stats)
    })
    const pitchingApps = scored.filter((g) => g.pitched).length
    const starts = scored.filter((g) => g.started).length
    const latest = scored[0]!
    const pos = rankPositionFor(sport, args.identityPositions.get(playerId), {
      pitchingApps,
      starts,
      lastGamePosition: scored.find((g) => g.position)?.position ?? null,
    })

    let part: number | null = null
    if (sport === 'MLB' && (pos === 'SP' || pos === 'RP')) {
      const teamTotal = latest.team ? teamGames.get(latest.team)?.size ?? 0 : 0
      part = teamTotal > 0 ? Math.min(1, round4(pitchingApps / teamTotal)) : null
    }

    players[playerId] = {
      pos,
      team: latest.team,
      sg: scored.length,
      ss: roundLine(ss),
      rg: Math.min(recentGames, scored.length),
      rs: roundLine(rs),
      part,
    }
  }

  return { v: 1, sport, season: args.season, computedAt: args.computedAt.toISOString(), recentGames, players }
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000
}

/** Stored lines are sums of box-score counts; four decimals keeps innings thirds exact enough. */
function roundLine(line: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(line)) if (Number.isFinite(v) && v !== 0) out[k] = round4(v)
  return out
}

// ── Read side: pure arithmetic over a stored blob and a league scorer ─────────────────────────

export type StatScorer = (stats: Record<string, number>, position?: string | null) => number

export type ScoredFormPlayer = {
  id: string
  pos: string | null
  /** Season fantasy points under THIS league's scoring. */
  seasonPoints: number
  /** Recent per-game points under this league's scoring; null below MIN_RECENT_FORM_GAMES. */
  perGame: number | null
  recentGames: number
  part: number | null
  team: string | null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function scoreFormBlob(blob: DailySportFormBlob, scorer: StatScorer): Map<string, ScoredFormPlayer> {
  const out = new Map<string, ScoredFormPlayer>()
  for (const [id, p] of Object.entries(blob.players)) {
    const seasonPoints = round2(scorer(p.ss, p.pos))
    const perGame = p.rg >= MIN_RECENT_FORM_GAMES ? round2(scorer(p.rs, p.pos) / p.rg) : null
    out.set(id, { id, pos: p.pos, seasonPoints, perGame, recentGames: p.rg, part: p.part, team: p.team })
  }
  return out
}

export type PositionRank = { position: string; rank: number; of: number }

/**
 * Rank within position by season points, highest first. Ties share a rank and the next rank skips
 * ("1, 2, 2, 4") — two players on the same total are the same rank, and saying otherwise invents an
 * order. A player with no rank group is not ranked.
 */
export function positionRanks(players: Iterable<ScoredFormPlayer>): Map<string, PositionRank> {
  const groups = new Map<string, ScoredFormPlayer[]>()
  for (const p of players) {
    if (!p.pos) continue
    const list = groups.get(p.pos) ?? []
    list.push(p)
    groups.set(p.pos, list)
  }
  const out = new Map<string, PositionRank>()
  for (const [position, list] of groups) {
    list.sort((a, b) => b.seasonPoints - a.seasonPoints || a.id.localeCompare(b.id))
    let rank = 0
    let prev: number | null = null
    list.forEach((p, i) => {
      if (prev == null || p.seasonPoints !== prev) rank = i + 1
      prev = p.seasonPoints
      out.set(p.id, { position, rank, of: list.length })
    })
  }
  return out
}

/** "C12", "SP34" — the same shape the NFL Player Finder prints ("WR12"). */
export function formatPositionRank(rank: PositionRank | null | undefined): string | null {
  return rank ? `${rank.position}${rank.rank}` : null
}

/**
 * Ruled out for the period: IR / IL / out / suspended (the shared reading in injuryStatus.ts), or
 * Rolling Insights' INACT. Questionable and day-to-day are NOT absence — zeroing them would tell a
 * manager to bench a player who is probably playing.
 */
export function isUnavailableForProjection(status: string | null | undefined): boolean {
  if (isRuledOut(status)) return true
  return /\binact(ive)?\b/i.test(String(status ?? ''))
}

/**
 * The period projection. Null when there is no rate or the period's slate is unknown; 0 is a real
 * claim — his team has no game, or he is ruled out — and is returned only for those.
 */
export function projectPeriodPoints(args: {
  perGame: number | null
  teamGames: number | null
  available: boolean
  part: number | null
}): number | null {
  if (args.perGame == null || args.teamGames == null) return null
  if (!args.available || args.teamGames === 0) return 0
  return round2(args.perGame * args.teamGames * (args.part ?? 1))
}
