/**
 * Canonical player-week score source (G11 Phase 2b) — DB-backed binding for the
 * pure `mergeCanonicalPlayerScores` adapter.
 *
 * Loads both stores and applies the precedence rule so every live surface (matchup
 * center, team/roster, league) reads the SAME score a concept's engine produces:
 *  - materialized `WeeklyScore` (generic `weeklyProcessor` output) wins when present
 *  - else the raw `PlayerWeeklyScore` stat line, scored by the league's authoritative
 *    scorer. For redraft/keeper/dynasty/etc. that is `calculateScoreFromSportConfig`
 *    (the exact path the redraft engine + roster route use, incl. the R1 DST bridge),
 *    so no scoring math is duplicated and totals can never conflict.
 *
 * Reusable across concepts: pass a different `scoreFromStats` to plug a concept's
 * own scorer; the default is the sport-config scorer that all redraft-family formats
 * share.
 */

import { prisma } from '@/lib/prisma'
import { calculateScoreFromSportConfig } from '@/lib/redraft/scoringEngine'
import {
  mergeCanonicalPlayerScores,
  type CanonicalPlayerWeekScore,
  type MaterializedScoreRow,
  type PlayerStatScorer,
  type RawStatRow,
  type RequestedPlayer,
} from '@/lib/live-scoring/playerScoreReadAdapter'

function asNumberStats(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(v)
    if (Number.isFinite(n)) out[k] = n
  }
  return out
}

/**
 * The sport-config scorer shared by every redraft-family concept. Bound to a league
 * + week so it can be injected into the pure adapter. Mirrors the redraft roster
 * route exactly (sport-config `categoryPoints`, DST via the R1 bridge).
 */
export function sportConfigStatScorer(leagueId: string, week: number): PlayerStatScorer {
  return ({ playerId, stats, position }) =>
    calculateScoreFromSportConfig(leagueId, playerId, week, stats, position)
}

/**
 * Resolve canonical per-player fantasy points for a league/week. Read-only and
 * idempotent. `players` carries position so the scorer can apply position-aware
 * rules (TE premium, IDP, DST). `rosterId` scopes the materialized lookup to the
 * roster's committed rows (matching the matchup-center's existing query shape).
 */
export async function loadCanonicalPlayerScores(params: {
  leagueId: string
  sport: string
  season: number
  week: number
  rosterId?: string
  players: readonly RequestedPlayer[]
  /** Defaults to the sport-config scorer (redraft-family). */
  scoreFromStats?: PlayerStatScorer
}): Promise<Map<string, CanonicalPlayerWeekScore>> {
  const playerIds = params.players.map((p) => p.playerId)
  if (playerIds.length === 0) return new Map()

  const [materializedRows, rawRows] = await Promise.all([
    prisma.weeklyScore.findMany({
      where: {
        leagueId: params.leagueId,
        season: params.season,
        week: params.week,
        ...(params.rosterId ? { rosterId: params.rosterId } : {}),
        playerId: { in: playerIds },
      },
      select: { playerId: true, points: true, statLine: true },
    }),
    prisma.playerWeeklyScore.findMany({
      where: {
        playerId: { in: playerIds },
        week: params.week,
        season: params.season,
        sport: params.sport,
      },
      select: { playerId: true, stats: true, isFinalized: true },
    }),
  ])

  const materialized = new Map<string, MaterializedScoreRow>(
    materializedRows.map(
      (r: { playerId: string; points: number; statLine: unknown }): [string, MaterializedScoreRow] => [
        r.playerId,
        { playerId: r.playerId, points: r.points, statLine: r.statLine },
      ],
    ),
  )
  const rawStats = new Map<string, RawStatRow>(
    rawRows.map(
      (r: { playerId: string; stats: unknown; isFinalized: boolean }): [string, RawStatRow] => [
        r.playerId,
        { playerId: r.playerId, stats: asNumberStats(r.stats), isFinalized: r.isFinalized },
      ],
    ),
  )

  return mergeCanonicalPlayerScores({
    requestedPlayers: params.players,
    materialized,
    rawStats,
    scoreFromStats: params.scoreFromStats ?? sportConfigStatScorer(params.leagueId, params.week),
  })
}
