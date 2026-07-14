/**
 * PlayerExposure aggregate — pure computation over a Manager's current roster
 * footprint across their leagues. Takes an already-loaded roster snapshot
 * array rather than querying Prisma itself, so this stays unit-testable with
 * fixture data — the real Prisma-backed loader lives in RosterSnapshotLoader.ts.
 */

import type { ConfidenceEnvelope, PlayerExposureMetrics, SourceAttribution } from './types'

export interface ManagerRosterSnapshot {
  leagueId: string
  playerIds: string[]
}

export function computePlayerExposureMetrics(
  playerId: string,
  rosters: ManagerRosterSnapshot[]
): PlayerExposureMetrics {
  const totalLeagueCount = rosters.length
  const rosteredInLeagueCount = rosters.filter((r) => r.playerIds.includes(playerId)).length
  return {
    playerId,
    rosteredInLeagueCount,
    totalLeagueCount,
    exposureShare: totalLeagueCount > 0 ? rosteredInLeagueCount / totalLeagueCount : 0,
  }
}

/** Confidence scales with how many of the manager's leagues we could observe — capped at 1 around 10 leagues, a smaller denominator than the trade/waiver profile's since most managers participate in far fewer leagues than trades. A documented placeholder heuristic, not a statistically rigorous model. */
function confidenceFromLeagueCount(totalLeagueCount: number): number {
  return Math.min(1, totalLeagueCount / 10)
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

export function buildPlayerExposureConfidenceEnvelope(
  metrics: PlayerExposureMetrics,
  sourceAttribution: SourceAttribution
): ConfidenceEnvelope {
  const sampleSize = metrics.totalLeagueCount
  const confidence = confidenceFromLeagueCount(sampleSize)
  const p = metrics.exposureShare

  // Wald interval for a proportion — a standard, simple approximation appropriate
  // for a foundation phase; not a claim of statistical rigor beyond that.
  const stderr = sampleSize > 0 ? Math.sqrt((p * (1 - p)) / sampleSize) : 0
  const uncertainty = sampleSize > 0 ? { low: clamp01(p - 1.96 * stderr), high: clamp01(p + 1.96 * stderr) } : null

  return {
    confidence,
    freshness: { computedAt: new Date(), isStale: false },
    evidence: [], // exposure is derived from current roster state, not discrete signals — see README on why this is empty here, not fabricated
    sampleSize,
    sourceAttribution: [sourceAttribution],
    risk: 1 - confidence,
    uncertainty,
  }
}
