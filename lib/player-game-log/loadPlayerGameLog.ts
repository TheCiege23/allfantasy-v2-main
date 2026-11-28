import 'server-only'

import { prisma } from '@/lib/prisma'
import { getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveStoredSeasonType } from '@/lib/sports-data/riSeasonType'
import { easternCalendarDay } from '@/lib/sports-data/easternGameDay'
import { LIVE_SCORE_SOURCES } from '@/lib/scores/liveSourceSelection'
import {
  GROUP_LABELS,
  computeGameLogValues,
  gameLogColumns,
  gameLogGroups,
  gameLogLinePlayed,
  ratioInputsFor,
  type GameLogColumn,
  type GameLogSport,
  type GameLogValue,
} from './gameLogColumns'

/**
 * A player's per-game log for one season, read from Postgres only.
 *
 * Source rows are `player_game_stats` (one per player per game per box GROUP, written by
 * `lib/sports-data/rollingInsightsGameLogs.ts`), keyed by `PlayerIdentityMap.id`. The final score
 * comes from `SportsGame` — never from a provider call on this path (CLAUDE.md, DB-first boundary).
 *
 * ⚠ A MISSING SCORE IS SHOWN AS MISSING. `SportsGame` rows exist for NHL and NBA from the daily
 * sweep (`persistSchedule`) and for any sport the live tick touched; a game with no row gets
 * `teamScore: null` and no W/L — never a result inferred from the player's own line.
 *
 * Preseason lines are left out (`resolveStoredSeasonType` === 'pre'); playoff lines are kept and
 * flagged.
 */

export interface GameLogRow {
  gameId: string
  /** US Eastern game day, `YYYY-MM-DD`. */
  date: string | null
  team: string | null
  opponent: string | null
  /** true = home, false = away, null = unknown. */
  home: boolean | null
  teamScore: number | null
  oppScore: number | null
  result: 'W' | 'L' | 'T' | null
  postseason: boolean
  played: boolean
  values: Record<string, GameLogValue>
  ratioInputs: Record<string, number>
  /**
   * Fantasy points for this game under the scoring the caller passed (a league's own settings, or the
   * sport's defaults). Null when he did not play or the line has no scorable stat — never a 0 that
   * reads as "played and scored nothing".
   */
  fantasyPoints: number | null
}

/** Stat line (the daily normalizer's output, as the weekly scorer reads it) and position to points. */
export type GameLogScorer = (stats: Record<string, number>, position?: string | null) => number

export interface GameLogGroup {
  group: string
  label: string
  columns: GameLogColumn[]
  rows: GameLogRow[]
}

export interface PlayerGameLog {
  sport: GameLogSport
  season: number | null
  /** Seasons with at least one stored game, newest first. */
  seasons: number[]
  groups: GameLogGroup[]
}

const MAX_ROWS = 260

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const dayKey = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null)

const norm = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase()

export async function loadPlayerGameLog(opts: {
  identityId: string
  sport: GameLogSport
  season?: number | null
  /**
   * Scores each game. Pass `buildLeagueStatScorer(league)` (lib/redraft/scoringEngine.ts) — the same
   * scorer the weekly matchup engine applies to the same normalized line, so a game here and that
   * game's share of the matchup agree.
   */
  scorer?: GameLogScorer | null
  position?: string | null
}): Promise<PlayerGameLog> {
  const { identityId, sport } = opts
  const empty: PlayerGameLog = { sport, season: null, seasons: [], groups: [] }

  const seasonRows = await prisma.playerGameStat.groupBy({
    by: ['season'],
    where: { playerId: identityId, sportType: sport },
    orderBy: { season: 'desc' },
  })
  const seasons = seasonRows.map((r) => r.season)
  if (seasons.length === 0) return empty
  const season = opts.season != null && seasons.includes(opts.season) ? opts.season : seasons[0]

  const rows = await prisma.playerGameStat.findMany({
    where: { playerId: identityId, sportType: sport, season },
    orderBy: [{ gameDate: 'desc' }, { gameId: 'desc' }],
    take: MAX_ROWS,
    select: {
      gameId: true,
      providerGameId: true,
      gameDate: true,
      team: true,
      opponent: true,
      season: true,
      statPayload: true,
      normalizedStatMap: true,
    },
  })

  const normalizer = getDailySportNormalizer(sport)
  const kept = rows.filter(
    (r) => resolveStoredSeasonType({ normalizedStatMap: r.normalizedStatMap, sport, season: r.season, gameDate: r.gameDate }) !== 'pre',
  )

  const scores = await loadScores(sport, kept)

  const byGroup = new Map<string, GameLogRow[]>()
  for (const r of kept) {
    const map = asRecord(r.normalizedStatMap)
    const group = typeof map.group === 'string' ? map.group : 'all'
    const raw = asRecord(r.statPayload)
    const stats = normalizer ? normalizer(r.normalizedStatMap).stats : {}
    const inputs = { stats, raw }
    const values = computeGameLogValues(sport, group, inputs)
    if (!values) continue

    const providerGameId = r.providerGameId ?? r.gameId.split(':')[0]
    const game = scores.byId.get(providerGameId) ?? scores.byDayTeams.get(`${dayKey(r.gameDate)}|${norm(r.team)}|${norm(r.opponent)}`)
    let home: boolean | null = null
    let teamScore: number | null = null
    let oppScore: number | null = null
    if (game) {
      const team = norm(r.team)
      if (team && team === norm(game.homeTeam)) home = true
      else if (team && team === norm(game.awayTeam)) home = false
      if (home != null && game.homeScore != null && game.awayScore != null && isFinal(game.status)) {
        teamScore = home ? game.homeScore : game.awayScore
        oppScore = home ? game.awayScore : game.homeScore
      }
    }
    const result =
      teamScore == null || oppScore == null ? null : teamScore > oppScore ? 'W' : teamScore < oppScore ? 'L' : sport === 'SOCCER' ? 'T' : null

    const played = gameLogLinePlayed(sport, group, inputs)
    let fantasyPoints: number | null = null
    if (opts.scorer && played && Object.keys(stats).length > 0) {
      const pts = opts.scorer(stats, opts.position ?? null)
      fantasyPoints = Number.isFinite(pts) ? Math.round(pts * 100) / 100 : null
    }

    const row: GameLogRow = {
      gameId: r.gameId,
      date: dayKey(r.gameDate),
      team: r.team,
      opponent: r.opponent,
      home,
      teamScore,
      oppScore,
      result,
      postseason: map.seasonType === 'post',
      played,
      values,
      ratioInputs: ratioInputsFor(sport, group, stats),
      fantasyPoints,
    }
    const list = byGroup.get(group) ?? []
    list.push(row)
    byGroup.set(group, list)
  }

  const groups: GameLogGroup[] = gameLogGroups(sport)
    .filter((g) => (byGroup.get(g)?.length ?? 0) > 0)
    .map((g) => ({ group: g, label: GROUP_LABELS[g] ?? g, columns: gameLogColumns(sport, g), rows: byGroup.get(g)! }))
    // The group he plays most leads (a two-way MLB player's batting before one relief inning).
    .sort((a, b) => b.rows.filter((r) => r.played).length - a.rows.filter((r) => r.played).length)

  return { sport, season, seasons, groups }
}

function isFinal(status: string | null | undefined): boolean {
  const s = String(status ?? '').trim().toLowerCase()
  if (!s) return true // A past game with both scores and no status is a settled box, not a live one.
  return /final|complete|closed|full.?time|^ft$|post/.test(s)
}

type ScoreGame = { homeTeam: string; awayTeam: string; homeScore: number | null; awayScore: number | null; status: string | null }

async function loadScores(
  sport: GameLogSport,
  rows: Array<{ providerGameId: string | null; gameId: string; gameDate: Date | null; team: string | null; opponent: string | null }>,
): Promise<{ byId: Map<string, ScoreGame>; byDayTeams: Map<string, ScoreGame> }> {
  const byId = new Map<string, ScoreGame>()
  const byDayTeams = new Map<string, ScoreGame>()
  if (rows.length === 0) return { byId, byDayTeams }

  const ids = [...new Set(rows.map((r) => r.providerGameId ?? r.gameId.split(':')[0]))]
  const exact = await prisma.sportsGame
    .findMany({
      where: { sport, source: 'rolling_insights', externalId: { in: ids } },
      select: { externalId: true, homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, status: true },
    })
    .catch(() => [])
  for (const g of exact) byId.set(g.externalId, g)

  // Fallback for games the Rolling Insights sweep did not persist: any ranked score feed's row on the
  // same Eastern day between the same two team codes. Codes that differ across feeds simply miss.
  const missing = rows.filter((r) => !byId.has(r.providerGameId ?? r.gameId.split(':')[0]) && r.gameDate && r.team && r.opponent)
  if (missing.length > 0) {
    const times = missing.map((r) => r.gameDate!.getTime())
    const from = new Date(Math.min(...times) - 86_400_000)
    const to = new Date(Math.max(...times) + 2 * 86_400_000)
    const near = await prisma.sportsGame
      .findMany({
        where: {
          sport,
          source: { in: [...LIVE_SCORE_SOURCES] },
          startTime: { gte: from, lte: to },
          homeScore: { not: null },
          awayScore: { not: null },
        },
        select: { homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, status: true, startTime: true },
        take: 5000,
      })
      .catch(() => [])
    for (const g of near) {
      const day = dayKey(easternCalendarDay(g.startTime))
      if (!day) continue
      const h = norm(g.homeTeam), a = norm(g.awayTeam)
      if (!byDayTeams.has(`${day}|${h}|${a}`)) byDayTeams.set(`${day}|${h}|${a}`, g)
      if (!byDayTeams.has(`${day}|${a}|${h}`)) byDayTeams.set(`${day}|${a}|${h}`, g)
    }
  }
  return { byId, byDayTeams }
}
