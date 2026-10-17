import { prisma } from '@/lib/prisma'
import { computeWinProbability, type MatchupPlayer } from '@/lib/projections/winProbability'
import { computeLeagueProjectedPoints, extractScoringSettings } from '@/lib/projections/leagueScoring'

/**
 * Where a manager STANDS in a live league-week: platform points, head-to-head pairing,
 * win probability and projected finish. Read by the per-slate digest
 * (lib/live/slateDigest.ts).
 *
 * ⚠ THIS USED TO SEND AN ALERT ON EVERY SWING, AND THAT WAS REVERSED 2026-10-11.
 * The 2026-09-14 decision alerted when the lead changed hands or win probability moved
 * 15+ points. Measured over the next 14 days in production: 1,147 alerts to 41 managers
 * (about 28 each), 12.7% read, against 50% for injury alerts; one manager got 95 in a
 * single league in a single day, and "lost the lead" (434) and "took the lead" (400)
 * were nearly equal, so a close game pinged on every possession. The owner reversed it:
 * one summary per manager per slate instead (slateDigest.ts). The per-play alerts
 * (`bigPlayNotifier`) are untouched — they sent 5 in the same window.
 *
 * ⚠ POINTS ARE THE PLATFORM'S, NEVER RECOMPUTED. Totals are sums of
 * `LeaguePlayerWeeklyScore` rows exactly as Sleeper scored them. Only the PROJECTION
 * half of win probability is ours, and it is the same league-rescored projection the
 * Matchup screen uses (`matchupProjections.ts`), so a digest and the screen agree.
 */

export type ScoreRow = {
  playerId: string
  rosterId: number | null
  isStarter: boolean
  points: number
}

export type PairingRow = { rosterId: string; matchupId: number | null }

export type RosterState = {
  rosterId: string
  /** Sum of starters' platform points. 0 when the roster has no scoring yet. */
  total: number
  starters: Map<string, number>
  /** Sleeper writes a roster's rows only once it has real scoring. */
  hasRows: boolean
  opponentRosterId: string | null
  /** Null when either side has no rows, or any starter could not be priced. */
  pWin: number | null
  /** Points so far plus each starter's remaining projection. Null when any starter is unpriced. */
  projectedFinish: number | null
}

export type LeagueWeekState = {
  rosters: Map<string, RosterState>
  /**
   * Rosters currently projected to finish last (ties included). Null when the league
   * cannot be ranked — a roster with no rows or an unpriced starter — because ranking
   * the priced teams above the unpriced ones is an artefact of coverage, not of play.
   */
  lowestProjected: Set<string> | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildLeagueWeekState(input: {
  rows: ScoreRow[]
  pairing: PairingRow[]
  projectionByPlayer: Map<string, number>
}): LeagueWeekState {
  const startersByRoster = new Map<string, Map<string, number>>()
  for (const row of input.rows) {
    if (!row.isStarter || row.rosterId == null) continue
    const key = String(row.rosterId)
    const map = startersByRoster.get(key) ?? new Map<string, number>()
    map.set(row.playerId, row.points)
    startersByRoster.set(key, map)
  }

  const matchupOf = new Map(input.pairing.map((p) => [String(p.rosterId), p.matchupId]))

  const priced = (starters: Map<string, number>): MatchupPlayer[] =>
    [...starters].map(([playerId, points]) => ({
      playerId,
      projectedPoints: input.projectionByPlayer.get(playerId) ?? null,
      actualPoints: points,
      /*
       * Nothing marks one player's game as over, so every starter is treated as still
       * to play. A starter who finished under projection then carries phantom
       * remaining variance — the model's own "safe direction" (see
       * `loadSideProjections`): more uncertainty, never false certainty.
       */
      isFinal: false,
    }))

  const rosters = new Map<string, RosterState>()
  for (const { rosterId: rawId, matchupId } of input.pairing) {
    const rosterId = String(rawId)
    const starters = startersByRoster.get(rosterId) ?? new Map<string, number>()
    const hasRows = startersByRoster.has(rosterId)
    const total = round2([...starters.values()].reduce((sum, p) => sum + p, 0))

    const opponents = matchupId == null
      ? []
      : input.pairing.filter((p) => String(p.rosterId) !== rosterId && p.matchupId === matchupId)
    const opponentRosterId = opponents.length === 1 ? String(opponents[0]!.rosterId) : null

    let projectedFinish: number | null = null
    if (hasRows) {
      let remaining = 0
      let unpriced = false
      for (const [playerId, points] of starters) {
        const proj = input.projectionByPlayer.get(playerId)
        if (proj == null) {
          unpriced = true
          break
        }
        remaining += Math.max(0, proj - points)
      }
      projectedFinish = unpriced ? null : round2(total + remaining)
    }

    let pWin: number | null = null
    const opponentStarters = opponentRosterId ? startersByRoster.get(opponentRosterId) : undefined
    if (hasRows && opponentStarters && matchupOf.get(rosterId) != null) {
      const result = computeWinProbability(
        { teamId: rosterId, starters: priced(starters) },
        { teamId: opponentRosterId!, starters: priced(opponentStarters) },
      )
      pWin = result.available ? result.pWin : null
    }

    rosters.set(rosterId, { rosterId, total, starters, hasRows, opponentRosterId, pWin, projectedFinish })
  }

  let lowestProjected: Set<string> | null = null
  const finishes = [...rosters.values()].map((r) => r.projectedFinish)
  if (finishes.length >= 2 && finishes.every((f): f is number => f != null)) {
    const min = Math.min(...finishes)
    lowestProjected = new Set([...rosters.values()].filter((r) => r.projectedFinish === min).map((r) => r.rosterId))
  }

  return { rosters, lowestProjected }
}

/** A league-week's starter rows, exactly as the platform scored them. */
export async function snapshotLeagueWeekScores(
  platformLeagueId: string,
  season: number,
  week: number,
): Promise<ScoreRow[]> {
  return prisma.leaguePlayerWeeklyScore.findMany({
    where: { leagueId: platformLeagueId, seasonYear: season, week },
    select: { playerId: true, rosterId: true, isStarter: true, points: true },
  })
}

/**
 * Build one league-week's state from the database: the platform's points, the week's
 * pairing, and the league-rescored projections. Null when there is no pairing to read
 * (fewer than two rosters scheduled). Database reads only — no provider call.
 */
export async function loadLeagueWeekState(input: {
  platformLeagueId: string
  season: number
  week: number
  settings: unknown
}): Promise<LeagueWeekState | null> {
  const { platformLeagueId, season, week } = input
  const [rows, pairing] = await Promise.all([
    snapshotLeagueWeekScores(platformLeagueId, season, week),
    prisma.weeklyMatchup.findMany({
      where: { leagueId: platformLeagueId, seasonYear: season, week },
      select: { rosterId: true, matchupId: true },
    }),
  ])
  if (pairing.length < 2) return null

  const starterIds = [...new Set(rows.filter((r) => r.isStarter).map((r) => r.playerId))]
  const scoring = extractScoringSettings(input.settings)
  const projectionByPlayer = new Map<string, number>()
  if (scoring && starterIds.length > 0) {
    const projections = await prisma.fantasyProjection.findMany({
      // AF mirror rows carry no component stat line to rescore — same filter as the Matchup screen.
      where: { playerId: { in: starterIds }, season: String(season), week, source: { not: 'allfantasy' } },
      select: { playerId: true, stats: true },
    })
    for (const p of projections) {
      if (projectionByPlayer.has(p.playerId)) continue
      const st = (p.stats ?? {}) as Record<string, unknown>
      const scored = computeLeagueProjectedPoints((st.stats ?? null) as Record<string, unknown> | null, scoring)
      if (scored) projectionByPlayer.set(p.playerId, scored.points)
    }
  }
  return buildLeagueWeekState({ rows, pairing, projectionByPlayer })
}
