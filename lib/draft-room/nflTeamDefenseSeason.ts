/**
 * Team defense (DEF) season stats for the NFL draft pool (2026-11-20). The DEF columns — SACK, INT,
 * TD, PA/G — were always dashes because nothing filled them.
 *
 * Built only from what Postgres already holds; no provider is called:
 *   - SACK, INT, TD: the sum of that team's defensive players' Rolling Insights season rows
 *     (`player_season_stats`: `sacks`, `interceptions`, `interception_touchdowns` +
 *     `fumble_return_touchdowns`). A player's season row carries one team, so a defender traded
 *     mid-season counts toward his current club — a small, known approximation.
 *   - PA/G: points allowed per game from the stored regular-season scores (`SportsGame`, weeks 1–18,
 *     one row per game even when two feeds carry it).
 *
 *   - FR: each defender's recoveries read by `playerFumbleRecoveries`, which drops the vendor's
 *     games-played echo and never adds the two copies of the count. Summing the raw
 *     `defense_fumble_recoveries` made one 2025 defense look like it recovered 28 fumbles; read
 *     this way every 2025 team totals 4–12.
 *
 *   - PTS / AVG: fantasy points, scored ONE GAME AT A TIME — DST scoring needs each game's
 *     points-allowed tier, which a season total cannot give. The games are the whole-team defense
 *     rows in `player_game_stats` (playerId = the club code, Sleeper's weekly team line: 2025 holds
 *     exactly 32 x 17), normalized by `normalizeNflTeamDefenseWeeklyStats` — the same normalizer
 *     live leagues score a DEF week with — and scored by the caller's scorer (the league's own rules
 *     in the live room, the mock's PPR / Half / Standard setting in a mock). No scorer, no points.
 *     Checked against Sleeper's own per-game total on the same row: identical where the rules
 *     agree (BAL 2025 week 2: 15 and 15).
 */
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { normalizeNflTeamDefenseWeeklyStats } from '@/lib/scoring-runtime/nflStatNormalization'
import { playerFumbleRecoveries } from '@/lib/providers/rollingInsightsFumbleRecoveries'

export interface TeamDefenseLine {
  dst_sacks: number
  dst_interceptions: number
  dst_td: number
  dst_fumble_recoveries: number
  /** Fantasy points over the season's scored games, and per game; null with no scorer or no games. */
  dst_fantasy_points: number | null
  dst_fantasy_points_per_game: number | null
  /** Null when the schedule has no scored games for the team that season. */
  dst_points_allowed_per_game: number | null
  games: number
}

export type TeamDefenseByTeam = Map<string, TeamDefenseLine>

export const NFL_DEFENSIVE_POSITIONS = [
  'DL', 'DE', 'DT', 'NT', 'EDGE', 'LB', 'OLB', 'ILB', 'MLB', 'DB', 'CB', 'S', 'FS', 'SS',
] as const

export interface DefenderSeasonRow {
  team: string | null
  stats: unknown
  gamesPlayed?: number | null
}

export interface ScoredGameRow {
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  startTime: Date | string | null
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** One whole-team defense game line (`player_game_stats`, playerId = club code). */
export interface TeamDefenseGameRow {
  playerId: string
  weekOrRound: number
  normalizedStatMap: unknown
  statPayload: unknown
}

export type TeamDefenseScorer = (stats: Record<string, number>, position?: string | null) => number

/** Pure: each team's fantasy points over its games, scored game by game; one row per team-week. */
export function scoreTeamDefenseGames(
  rows: readonly TeamDefenseGameRow[],
  score: TeamDefenseScorer,
): Map<string, { points: number; games: number }> {
  const out = new Map<string, { points: number; games: number }>()
  const seen = new Set<string>()
  for (const row of rows) {
    const team = normalizeTeamAbbrev(row.playerId)
    if (!team) continue
    const key = `${team}|${row.weekOrRound}`
    if (seen.has(key)) continue
    const raw = isObject(row.normalizedStatMap) && Object.keys(row.normalizedStatMap).length ? row.normalizedStatMap : row.statPayload
    const stats = normalizeNflTeamDefenseWeeklyStats(raw)
    if (stats.def_points_allowed === undefined) {
      // Sleeper's lines leave zero values out, so a SHUTOUT has no `pts_allow` at all (SEA 2025
      // week 13: no points-allowed key, 32 points on Sleeper's own total). A line marked played
      // (`gp` >= 1) without it allowed 0; a line with neither has not been played.
      const gp = isObject(raw) ? raw.gp : undefined
      if (!(typeof gp === 'number' && gp >= 1)) continue
      stats.def_points_allowed = 0
    }
    seen.add(key)
    const points = score(stats, 'DEF')
    if (!Number.isFinite(points)) continue
    const total = out.get(team) ?? { points: 0, games: 0 }
    total.points += points
    total.games += 1
    out.set(team, total)
  }
  return out
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Pure: team totals from defenders' season rows and the season's scored games. */
export function summarizeTeamDefense(
  defenders: readonly DefenderSeasonRow[],
  games: readonly ScoredGameRow[],
  fantasy?: Map<string, { points: number; games: number }> | null,
): TeamDefenseByTeam {
  const out: TeamDefenseByTeam = new Map()
  const lineFor = (team: string) => {
    let line = out.get(team)
    if (!line) {
      line = {
        dst_sacks: 0, dst_interceptions: 0, dst_td: 0, dst_fumble_recoveries: 0,
        dst_fantasy_points: null, dst_fantasy_points_per_game: null,
        dst_points_allowed_per_game: null, games: 0,
      }
      out.set(team, line)
    }
    return line
  }

  for (const row of defenders) {
    const team = normalizeTeamAbbrev(row.team)
    if (!team || !row.stats || typeof row.stats !== 'object') continue
    const s = row.stats as Record<string, unknown>
    const line = lineFor(team)
    line.dst_sacks += num(s.sacks)
    line.dst_interceptions += num(s.interceptions)
    line.dst_td += num(s.interception_touchdowns) + num(s.fumble_return_touchdowns)
    line.dst_fumble_recoveries += playerFumbleRecoveries(s, row.gamesPlayed) ?? 0
  }

  const allowed = new Map<string, { points: number; games: number }>()
  const seen = new Set<string>()
  for (const g of games) {
    if (g.homeScore == null || g.awayScore == null) continue
    const home = normalizeTeamAbbrev(g.homeTeam)
    const away = normalizeTeamAbbrev(g.awayTeam)
    if (!home || !away) continue
    const day = g.startTime ? new Date(g.startTime).toISOString().slice(0, 10) : ''
    const id = `${home}|${away}|${day}`
    if (seen.has(id)) continue
    seen.add(id)
    for (const [team, against] of [[home, g.awayScore], [away, g.homeScore]] as const) {
      const a = allowed.get(team) ?? { points: 0, games: 0 }
      a.points += against
      a.games += 1
      allowed.set(team, a)
    }
  }
  for (const [team, a] of allowed) {
    const line = lineFor(team)
    line.games = a.games
    line.dst_points_allowed_per_game = a.games > 0 ? Math.round((a.points / a.games) * 10) / 10 : null
  }

  for (const [team, f] of fantasy ?? []) {
    if (f.games <= 0) continue
    const line = lineFor(team)
    line.dst_fantasy_points = Math.round(f.points * 10) / 10
    line.dst_fantasy_points_per_game = Math.round((f.points / f.games) * 10) / 10
  }

  for (const line of out.values()) line.dst_sacks = Math.round(line.dst_sacks * 10) / 10
  return out
}

/** Club codes a whole-team defense row may use as its playerId (current and older spellings). */
const NFL_TEAM_CODES_AND_ALIASES = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND',
  'JAX', 'JAC', 'KC', 'LAC', 'LAR', 'LA', 'LV', 'OAK', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI',
  'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS', 'WSH',
]

const isDefenseUnit = (position: unknown) => {
  const p = String(position ?? '').trim().toUpperCase()
  return p === 'DEF' || p === 'DST' || p === 'D/ST'
}

/**
 * Pure: put a team's line into each DEF row's `display.stats`, where the DEF columns read it.
 * Other rows, and a DEF row whose team is unknown, come back untouched.
 */
export function attachTeamDefenseStats<T>(entries: T[], byTeam: TeamDefenseByTeam): T[] {
  if (byTeam.size === 0) return entries
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    const row = entry as Record<string, unknown>
    if (!isDefenseUnit(row.position)) return entry
    const team = normalizeTeamAbbrev(typeof row.team === 'string' ? row.team : null)
    const line = team ? byTeam.get(team) : undefined
    if (!line) return entry
    const display = (row.display && typeof row.display === 'object' ? row.display : {}) as Record<string, unknown>
    const stats = (display.stats && typeof display.stats === 'object' ? display.stats : {}) as Record<string, unknown>
    const { games: _games, ...columns } = line
    const merged: Record<string, unknown> = { ...stats }
    for (const [k, v] of Object.entries(columns)) if (typeof v === 'number') merged[k] = v
    // PTS and AVG read the generic keys every NFL row uses.
    if (line.dst_fantasy_points != null) merged.pts = line.dst_fantasy_points
    if (line.dst_fantasy_points_per_game != null) merged.fantasyPointsPerGame = line.dst_fantasy_points_per_game
    return { ...row, display: { ...display, stats: merged } } as T
  })
}

/** Server: one season's team defense lines from Postgres. Empty (not an error) when nothing is stored. */
export async function loadNflTeamDefenseSeason(
  season: number | string,
  /** Scores one DEF game; without it PTS / AVG stay empty. */
  score?: TeamDefenseScorer | null,
): Promise<TeamDefenseByTeam> {
  const year = Number(season)
  if (!Number.isInteger(year)) return new Map()
  const { prisma } = await import('@/lib/prisma')
  const [defenders, games, teamGames] = await Promise.all([
    prisma.playerSeasonStats.findMany({
      where: {
        sport: 'NFL',
        season: String(year),
        seasonType: 'regular',
        source: 'rolling_insights',
        position: { in: [...NFL_DEFENSIVE_POSITIONS] },
      },
      select: { team: true, stats: true, gamesPlayed: true },
    }),
    prisma.sportsGame.findMany({
      where: { sport: 'NFL', season: year, week: { gte: 1, lte: 18 }, homeScore: { not: null }, awayScore: { not: null } },
      select: { homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, startTime: true },
    }),
    score
      ? prisma.playerGameStat.findMany({
          where: {
            sportType: { in: ['NFL', 'nfl'] },
            season: year,
            weekOrRound: { gte: 1, lte: 18 },
            playerId: { in: NFL_TEAM_CODES_AND_ALIASES },
          },
          select: { playerId: true, weekOrRound: true, normalizedStatMap: true, statPayload: true },
          orderBy: { weekOrRound: 'asc' },
        })
      : Promise.resolve([] as TeamDefenseGameRow[]),
  ])
  return summarizeTeamDefense(defenders, games, score ? scoreTeamDefenseGames(teamGames, score) : null)
}
