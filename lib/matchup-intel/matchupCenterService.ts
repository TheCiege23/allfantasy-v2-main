import 'server-only'

/**
 * matchupCenterService — the current week's matchups with LIVE scores and a
 * win probability computed from the same weekly projections the projected
 * standings use, scored with the league's REAL scoring settings.
 *
 * The probability model is simple and printed with the payload so it can be
 * argued with: each team's weekly score is treated as normal around its
 * projected total with σ = 28 league-scored points (an explicit heuristic);
 * P(A beats B) = Φ((projA − projB) / (σ·√2)). It is a PRE-GAME projection
 * model — once games kick off, actual points are shown alongside and the
 * label says the probability is projection-based, not a live in-game model.
 */

import { getLeagueContext } from '@/lib/league-context/leagueContextService'
import { getWeekBoard, scoreStatLine } from '@/lib/sports-data/sleeperMarketService'

const SLEEPER = 'https://api.sleeper.app/v1'
const SIGMA = 28

async function j<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SLEEPER}${path}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

type WireState = { week?: number; season?: string; season_type?: string; display_week?: number }
type WireRoster = { roster_id: number; owner_id: string | null }
type WireUser = {
  user_id: string
  display_name: string
  avatar: string | null
  metadata?: { team_name?: string | null } | null
}
type WireMatchup = {
  roster_id: number
  matchup_id: number | null
  points: number
  starters?: string[] | null
}

/** Standard normal CDF via Abramowitz–Stegun erf approximation. */
function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2)
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2)
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf)
}

export type MatchupSide = {
  rosterId: number
  ownerId: string | null
  name: string
  teamName: string | null
  avatar: string | null
  actualPoints: number
  projectedPoints: number | null
  unprojectedStarters: number
}
export type MatchupRow = {
  matchupId: number
  a: MatchupSide
  b: MatchupSide
  /** P(a wins) from the projection model; null when projections missing. */
  winProbA: number | null
}
export type MatchupCenterPayload = {
  version: 1
  fetchedAt: string
  season: string
  week: number
  inSeason: boolean
  anyPointsScored: boolean
  matchups: MatchupRow[]
  model: string
  missing: string[]
}

export async function getMatchupCenter(sleeperLeagueId: string): Promise<MatchupCenterPayload | null> {
  const missing: string[] = []
  const context = await getLeagueContext(sleeperLeagueId)
  if (!context) return null

  const state = await j<WireState>(`/state/nfl`)
  const week = Math.min(Math.max(state?.week || 1, 1), 18)
  const inSeason = state?.season_type === 'regular'

  const [rosters, users, matchups, board] = await Promise.all([
    j<WireRoster[]>(`/league/${sleeperLeagueId}/rosters`),
    j<WireUser[]>(`/league/${sleeperLeagueId}/users`),
    j<WireMatchup[]>(`/league/${sleeperLeagueId}/matchups/${week}`),
    getWeekBoard(context.season, week),
  ])
  if (!rosters || !matchups) return null
  if (!users) missing.push('managers')
  if (!board) missing.push(`week-${week} projections`)

  const usersById = new Map((users ?? []).map((u) => [u.user_id, u]))
  const ownerOf = new Map(rosters.map((r) => [r.roster_id, r.owner_id ?? null]))

  const toSide = (m: WireMatchup): MatchupSide => {
    const ownerId = ownerOf.get(m.roster_id) ?? null
    const user = ownerId ? usersById.get(ownerId) : undefined
    let projected: number | null = null
    let unprojected = 0
    if (board) {
      let sum = 0
      let any = false
      for (const pid of (m.starters ?? []).filter((s) => s && s !== '0')) {
        const row = board.players[pid]
        if (!row || Object.keys(row.stats).length === 0) {
          unprojected += 1
          continue
        }
        sum += scoreStatLine(row.stats, context.scoring.settings, context.scoring.format).points
        any = true
      }
      projected = any ? Math.round(sum * 10) / 10 : null
    }
    return {
      rosterId: m.roster_id,
      ownerId,
      name: user?.display_name ?? 'Manager',
      teamName: user?.metadata?.team_name?.trim() || null,
      avatar: user?.avatar ?? null,
      actualPoints: Math.round((m.points ?? 0) * 10) / 10,
      projectedPoints: projected,
      unprojectedStarters: unprojected,
    }
  }

  const byMatchup = new Map<number, WireMatchup[]>()
  for (const m of matchups) {
    if (m.matchup_id == null) continue
    const list = byMatchup.get(m.matchup_id) ?? []
    list.push(m)
    byMatchup.set(m.matchup_id, list)
  }
  const rows: MatchupRow[] = []
  for (const [matchupId, pair] of byMatchup) {
    if (pair.length !== 2) continue
    const a = toSide(pair[0])
    const b = toSide(pair[1])
    let winProbA: number | null = null
    if (a.projectedPoints != null && b.projectedPoints != null) {
      winProbA =
        Math.round(phi((a.projectedPoints - b.projectedPoints) / (SIGMA * Math.SQRT2)) * 1000) / 10
    }
    rows.push({ matchupId, a, b, winProbA })
  }
  rows.sort((x, y) => x.matchupId - y.matchupId)

  return {
    version: 1,
    fetchedAt: new Date().toISOString(),
    season: context.season,
    week,
    inSeason,
    anyPointsScored: matchups.some((m) => (m.points ?? 0) > 0),
    matchups: rows,
    model: `Win probability = Φ((projA − projB)/(σ·√2)) with σ=${SIGMA} league-scored points (stated heuristic). Projections scored with this league's real settings. Pre-game model — actual scores shown once games start.`,
    missing,
  }
}
