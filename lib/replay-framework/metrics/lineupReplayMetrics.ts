/**
 * Decision OS Replay Framework Phase 13 — read-only validation metrics over
 * the real lineup replay corpus. Mirrors `tradeReplayMetrics.ts`'s exact
 * pattern (pure aggregate queries, no writes, no calibration impact) and
 * reuses `metrics/shared.ts`'s decision-type-agnostic primitives (Phase 11)
 * rather than re-implementing histogram/average logic.
 */
import { prisma } from '@/lib/prisma'
import type { LineupBacktestOutput, LineupReplayPayload } from '../types'
import { average, bucketize } from './shared'

export interface LineupReplayMetricsSummary {
  totalReplays: number
  totalBacktests: number
  seasons: number[]
  leagues: string[]
  avgActualPoints: number | null
  avgOptimalPoints: number | null
  /** Net: optimalPoints - actualPoints, averaged. */
  avgPointsLeftOnBench: number | null
  /** Gross: real points scored by optimal-lineup players who sat on the bench, averaged. */
  avgBenchValueLeft: number | null
  /** Gross: real points scored by actual starters who weren't part of the optimal lineup, averaged. */
  avgPointsFromSuboptimalStarters: number | null
  /** "Optimal lineup %" / starter efficiency. */
  avgEfficiencyPct: number | null
  avgStartSitMistakeCount: number | null
  efficiencyDistribution: Array<{ bucket: string; count: number }>
  pointsLeftOnBenchDistribution: Array<{ bucket: string; count: number }>
  /** "Weekly improvement" -- average efficiency grouped by providerWeek, across all real rows. */
  weeklyEfficiency: Array<{ week: number; avgEfficiencyPct: number | null; count: number }>
  /** "Position mistakes" -- how many missed-optimal-starter occurrences happened at each real position. */
  positionMistakeCounts: Record<string, number>
  leagueSensitivity: Array<{ providerLeagueId: string; season: number; count: number; avgEfficiencyPct: number | null }>
}

interface ReplayWithBacktest {
  providerLeagueId: string
  season: number
  providerWeek: number | null
  payload: LineupReplayPayload
  backtestedOutput: LineupBacktestOutput
}

/**
 * `pointsLeftOnBench` is a non-negative, unbounded PPG-style value (by
 * construction, the optimal lineup can never score less than the actual
 * one) -- a simple 0-100 histogram doesn't fit it the way it fits a 0-1
 * probability, so a small set of fixed-width buckets is used instead,
 * matching the spirit of `bucketizeSignedMagnitude()` (Phase 11) without
 * reusing it directly (that helper's buckets are tuned for PPG deltas in
 * the -15..+15 range typical of trade lineup deltas; lineup replay's own
 * points-left-on-bench values run wider, since a full week's bench often
 * includes several unscored/DNP players alongside real depth).
 */
function bucketizePointsLeftOnBench(values: number[]): Array<{ bucket: string; count: number }> {
  const buckets: Array<[string, (v: number) => boolean]> = [
    ['0 (optimal)', (v) => v === 0],
    ['0 to 5', (v) => v > 0 && v < 5],
    ['5 to 15', (v) => v >= 5 && v < 15],
    ['15 to 30', (v) => v >= 15 && v < 30],
    ['30+', (v) => v >= 30],
  ]
  return buckets.map(([bucket, test]) => ({ bucket, count: values.filter(test).length }))
}

/**
 * Fetches every real `lineup`-decisionType replay+backtest row currently in
 * staging and computes the full validation-metrics summary. Read-only: two
 * `findMany` calls, zero writes, no effect on any live route.
 */
export async function computeLineupReplayMetrics(providerLeagueIds?: string[]): Promise<LineupReplayMetricsSummary> {
  const leagueFilter = providerLeagueIds && providerLeagueIds.length > 0 ? { providerLeagueId: { in: providerLeagueIds } } : {}

  const [replays, backtests] = await Promise.all([
    prisma.replayImport.findMany({
      where: { decisionType: 'lineup', ...leagueFilter },
      select: { id: true, providerLeagueId: true, season: true, providerWeek: true, payload: true },
    }),
    prisma.replayBacktestResult.findMany({
      where: { decisionType: 'lineup', replay: { ...leagueFilter } },
      select: { replayId: true, backtestedOutput: true },
    }),
  ])

  const replayById = new Map(replays.map((r) => [r.id, r]))
  const rows: ReplayWithBacktest[] = []
  for (const bt of backtests) {
    const replay = replayById.get(bt.replayId)
    if (!replay) continue
    rows.push({
      providerLeagueId: replay.providerLeagueId,
      season: replay.season,
      providerWeek: replay.providerWeek,
      payload: replay.payload as unknown as LineupReplayPayload,
      backtestedOutput: bt.backtestedOutput as unknown as LineupBacktestOutput,
    })
  }

  const actualPoints = rows.map((r) => r.backtestedOutput.actualPoints)
  const optimalPoints = rows.map((r) => r.backtestedOutput.optimalPoints)
  const pointsLeftOnBench = rows.map((r) => r.backtestedOutput.pointsLeftOnBench)
  const benchValueLeft = rows.map((r) => r.backtestedOutput.benchValueLeft)
  const pointsFromSuboptimal = rows.map((r) => r.backtestedOutput.pointsFromSuboptimalStarters)
  const efficiencyPcts = rows.map((r) => r.backtestedOutput.efficiencyPct)
  const mistakeCounts = rows.map((r) => r.backtestedOutput.startSitMistakeCount)

  const weekGroups = new Map<number, number[]>()
  for (const r of rows) {
    if (r.providerWeek == null) continue
    const list = weekGroups.get(r.providerWeek) ?? []
    list.push(r.backtestedOutput.efficiencyPct)
    weekGroups.set(r.providerWeek, list)
  }
  const weeklyEfficiency = Array.from(weekGroups.entries())
    .sort(([a], [b]) => a - b)
    .map(([week, effs]) => ({ week, avgEfficiencyPct: average(effs), count: effs.length }))

  const positionMistakeCounts: Record<string, number> = {}
  for (const r of rows) {
    const posByProviderId = new Map(r.payload.fullRoster.map((p) => [p.providerAssetId, p.pos]))
    for (const mistake of r.backtestedOutput.missedOptimalStarters) {
      const positions = posByProviderId.get(mistake.providerAssetId) ?? []
      const pos = positions[0] ?? 'UNKNOWN'
      positionMistakeCounts[pos] = (positionMistakeCounts[pos] ?? 0) + 1
    }
  }

  const leagueGroups = new Map<string, ReplayWithBacktest[]>()
  for (const r of rows) {
    const key = `${r.providerLeagueId}::${r.season}`
    const list = leagueGroups.get(key) ?? []
    list.push(r)
    leagueGroups.set(key, list)
  }
  const leagueSensitivity = Array.from(leagueGroups.entries()).map(([key, group]) => {
    const [providerLeagueId, seasonStr] = key.split('::')
    return {
      providerLeagueId,
      season: Number(seasonStr),
      count: group.length,
      avgEfficiencyPct: average(group.map((g) => g.backtestedOutput.efficiencyPct)),
    }
  })

  return {
    totalReplays: replays.length,
    totalBacktests: backtests.length,
    seasons: Array.from(new Set(replays.map((r) => r.season))).sort(),
    leagues: Array.from(new Set(replays.map((r) => r.providerLeagueId))),
    avgActualPoints: average(actualPoints),
    avgOptimalPoints: average(optimalPoints),
    avgPointsLeftOnBench: average(pointsLeftOnBench),
    avgBenchValueLeft: average(benchValueLeft),
    avgPointsFromSuboptimalStarters: average(pointsFromSuboptimal),
    avgEfficiencyPct: average(efficiencyPcts),
    avgStartSitMistakeCount: average(mistakeCounts),
    efficiencyDistribution: bucketize(efficiencyPcts),
    pointsLeftOnBenchDistribution: bucketizePointsLeftOnBench(pointsLeftOnBench),
    weeklyEfficiency,
    positionMistakeCounts,
    leagueSensitivity,
  }
}
