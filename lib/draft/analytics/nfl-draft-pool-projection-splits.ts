/**
 * NFL draft pool: season projection + rushing/receiving/passing splits for Sleeper-style grid UI.
 * Blank / null = no data (render em dash), never coerce missing stats to 0.
 */

import { parseRollingInsightsStatsJson } from '@/lib/players/rolling-insights-stats-display'

export type NflDraftProjectionSplits = {
  /** Where splits came from for debugging / future filters */
  source: 'rolling_insights_stats' | 'snapshot_projection' | 'mixed' | null
  /** Season projected fantasy points (snapshot expected or RI season total). */
  projectedPoints: number | null
  /** Points per game (pool display / RI). */
  projectedPointsPerGame: number | null
  rushing: { att: number | null; yds: number | null; td: number | null }
  receiving: { rec: number | null; tar: number | null; yds: number | null; td: number | null }
  passing: { cmp: number | null; att: number | null; yds: number | null; td: number | null; int: number | null }
  kicking?: { fg: number | null; xpt: number | null }
}

function num(raw: unknown, ...keys: string[]): number | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  for (const k of keys) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

const emptyRush = { att: null, yds: null, td: null } as const
const emptyRec = { rec: null, tar: null, yds: null, td: null } as const

function kickingFromRaw(statsJson: unknown): { fg: number | null; xpt: number | null } | undefined {
  if (!statsJson || typeof statsJson !== 'object') return undefined
  const fg = num(statsJson, 'field_goals_made', 'fg_made')
  const xpt = num(statsJson, 'extra_points_made', 'xp_made')
  if (fg == null && xpt == null) return undefined
  return { fg, xpt }
}

/**
 * Build splits for one pool row. Prefer RI `stats` JSON when present; fill projected points from snapshot or RI season totals.
 */
export function buildNflDraftProjectionSplits(args: {
  position: string
  statsJson: unknown | null
  /** PlayerAnalyticsSnapshot.expectedFantasyPoints */
  snapshotExpectedPoints: number | null
  /** PlayerSeasonStats.fantasyPoints (RI season) */
  riSeasonFantasyPoints: number | null
  /** Display FPPG already merged on pool row (snapshot or RI). */
  projectedPointsPerGame: number | null
}): NflDraftProjectionSplits | null {
  const pos = args.position.trim().toUpperCase()
  const parsed = args.statsJson ? parseRollingInsightsStatsJson(args.statsJson) : null

  const projectedPoints =
    args.snapshotExpectedPoints != null && Number.isFinite(Number(args.snapshotExpectedPoints))
      ? Number(args.snapshotExpectedPoints)
      : args.riSeasonFantasyPoints != null && Number.isFinite(Number(args.riSeasonFantasyPoints))
        ? Number(args.riSeasonFantasyPoints)
        : null

  const projectedPointsPerGame =
    args.projectedPointsPerGame != null && Number.isFinite(Number(args.projectedPointsPerGame))
      ? Number(args.projectedPointsPerGame)
      : null

  const hasRiSplits = parsed != null && Object.values(parsed).some((v) => v != null && Number.isFinite(v))
  const hasSnapshotProj = projectedPoints != null

  let source: NflDraftProjectionSplits['source'] = null
  if (hasRiSplits && hasSnapshotProj) source = 'mixed'
  else if (hasRiSplits) source = 'rolling_insights_stats'
  else if (hasSnapshotProj || projectedPointsPerGame != null) source = 'snapshot_projection'

  if (!hasRiSplits && !hasSnapshotProj && projectedPointsPerGame == null) {
    return null
  }

  const rush = parsed
    ? {
        att: parsed.rushAtt,
        yds: parsed.rushYd,
        td: parsed.rushTd,
      }
    : emptyRush
  const rec = parsed
    ? {
        rec: parsed.rec,
        tar: parsed.tar,
        yds: parsed.recYd,
        td: parsed.recTd,
      }
    : emptyRec
  const out: NflDraftProjectionSplits = {
    source,
    projectedPoints,
    projectedPointsPerGame,
    rushing: rush,
    receiving: rec,
    passing: parsed
      ? {
          cmp: parsed.passCmp,
          att: parsed.passAtt,
          yds: parsed.passYd,
          td: parsed.passTd,
          int: parsed.passInt,
        }
      : { cmp: null, att: null, yds: null, td: null, int: null },
  }

  if (pos === 'K') {
    const k = kickingFromRaw(args.statsJson)
    if (k) out.kicking = k
  }

  return out
}

/** All-null splits for NFL pool rows when no projection or RI stats are available (UI renders em dashes). */
export function emptyNflDraftProjectionSplits(): NflDraftProjectionSplits {
  return {
    source: null,
    projectedPoints: null,
    projectedPointsPerGame: null,
    rushing: { att: null, yds: null, td: null },
    receiving: { rec: null, tar: null, yds: null, td: null },
    passing: { cmp: null, att: null, yds: null, td: null, int: null },
  }
}

export function formatNflStatCell(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  return digits > 0 ? n.toFixed(digits) : String(Math.round(n))
}
