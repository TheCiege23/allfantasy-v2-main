import 'server-only'

/**
 * projectedStandingsService — pre-season standings from projected week-1
 * points (until real games are played, standings pages rank by this instead of
 * a wall of 0–0s).
 *
 * Per team: sum of the STARTERS' projected week-1 points, scored with the
 * league's REAL scoring settings via the LeagueContext envelope (IDP scoring
 * included when the feed projects those stat lines). Every number is traceable:
 *  - `mode` says whether points came from league-scored stat lines or the
 *    feed's format aggregate,
 *  - `unprojectedStarters` counts starters the feed had no line for (typical
 *    for some IDPs) — rendered, never hidden.
 */

import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import { getWeekBoard, scoreStatLine } from '@/lib/sports-data/sleeperMarketService'

const SLEEPER = 'https://api.sleeper.app/v1'

async function j<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SLEEPER}${path}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

type SleeperRoster = {
  roster_id: number
  owner_id: string | null
  starters?: string[] | null
  settings?: { wins?: number; losses?: number; ties?: number; fpts?: number } | null
}
type SleeperUser = {
  user_id: string
  display_name: string
  avatar: string | null
  metadata?: { team_name?: string | null } | null
}

export type ProjectedStandingRow = {
  rosterId: number
  ownerId: string | null
  name: string
  teamName: string | null
  avatar: string | null
  projectedPoints: number
  starters: number
  unprojectedStarters: number
}

export type ProjectedStandingsPayload = {
  version: 1
  fetchedAt: string
  sleeperLeagueId: string
  season: string
  week: number
  /** True while no real result exists yet — the ONLY state this ranking is for. */
  preseason: boolean
  scoringMode: 'league-scored' | 'format-approx' | 'mixed'
  rows: ProjectedStandingRow[]
  missing: string[]
}

export async function getProjectedStandings(
  sleeperLeagueId: string,
  week = 1,
): Promise<ProjectedStandingsPayload | null> {
  const context = await getLeagueContext(sleeperLeagueId)
  if (!context) return null

  const [rosters, users, board] = await Promise.all([
    j<SleeperRoster[]>(`/league/${sleeperLeagueId}/rosters`),
    j<SleeperUser[]>(`/league/${sleeperLeagueId}/users`),
    getWeekBoard(context.season, week),
  ])
  const missing: string[] = [...context.missing]
  if (!rosters) return null
  if (!users) missing.push('managers')
  if (!board) missing.push(`week-${week} projections`)

  const usersById = new Map((users ?? []).map((u) => [u.user_id, u]))
  const preseason = rosters.every(
    (r) =>
      (r.settings?.wins ?? 0) === 0 &&
      (r.settings?.losses ?? 0) === 0 &&
      (r.settings?.ties ?? 0) === 0 &&
      (r.settings?.fpts ?? 0) === 0,
  )

  const modes = new Set<'league-scored' | 'format-approx'>()
  const rows: ProjectedStandingRow[] = rosters.map((r) => {
    const starters = (r.starters ?? []).filter((s) => s && s !== '0')
    let projected = 0
    let unprojected = 0
    for (const playerId of starters) {
      const line = board?.players[playerId]
      if (!line || Object.keys(line.stats).length === 0) {
        unprojected += 1
        continue
      }
      const scored = scoreStatLine(line.stats, context.scoring.settings, context.scoring.format)
      modes.add(scored.mode)
      projected += scored.points
    }
    const user = r.owner_id ? usersById.get(r.owner_id) : undefined
    return {
      rosterId: r.roster_id,
      ownerId: r.owner_id,
      name: user?.display_name ?? 'Manager',
      teamName: user?.metadata?.team_name?.trim() || null,
      avatar: user?.avatar ?? null,
      projectedPoints: Math.round(projected * 10) / 10,
      starters: starters.length,
      unprojectedStarters: unprojected,
    }
  })
  rows.sort((a, b) => b.projectedPoints - a.projectedPoints)

  return {
    version: 1,
    fetchedAt: new Date().toISOString(),
    sleeperLeagueId,
    season: context.season,
    week,
    preseason,
    scoringMode: modes.size === 0 ? 'format-approx' : modes.size > 1 ? 'mixed' : [...modes][0],
    rows,
    missing,
  }
}
