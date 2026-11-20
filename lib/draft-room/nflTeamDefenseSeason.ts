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
 * Fantasy points (PTS / AVG) stay empty too: DST scoring needs per-game points-allowed tiers, and
 * this file only has season totals (see `nflDraftSeasonLine`, which refuses the same).
 */
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { playerFumbleRecoveries } from '@/lib/providers/rollingInsightsFumbleRecoveries'

export interface TeamDefenseLine {
  dst_sacks: number
  dst_interceptions: number
  dst_td: number
  dst_fumble_recoveries: number
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

/** Pure: team totals from defenders' season rows and the season's scored games. */
export function summarizeTeamDefense(defenders: readonly DefenderSeasonRow[], games: readonly ScoredGameRow[]): TeamDefenseByTeam {
  const out: TeamDefenseByTeam = new Map()
  const lineFor = (team: string) => {
    let line = out.get(team)
    if (!line) {
      line = { dst_sacks: 0, dst_interceptions: 0, dst_td: 0, dst_fumble_recoveries: 0, dst_points_allowed_per_game: null, games: 0 }
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

  for (const line of out.values()) line.dst_sacks = Math.round(line.dst_sacks * 10) / 10
  return out
}

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
    return { ...row, display: { ...display, stats: merged } } as T
  })
}

/** Server: one season's team defense lines from Postgres. Empty (not an error) when nothing is stored. */
export async function loadNflTeamDefenseSeason(season: number | string): Promise<TeamDefenseByTeam> {
  const year = Number(season)
  if (!Number.isInteger(year)) return new Map()
  const { prisma } = await import('@/lib/prisma')
  const [defenders, games] = await Promise.all([
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
  ])
  return summarizeTeamDefense(defenders, games)
}
