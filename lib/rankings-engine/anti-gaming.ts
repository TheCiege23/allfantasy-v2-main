import { SnapshotMetrics } from "./snapshots"

export interface AntiGamingInput {
  rosterId: number
  currentRank: number
  composite: number
  metrics: SnapshotMetrics
}

export interface AntiGamingResult {
  rosterId: number
  originalRank: number
  adjustedRank: number
  constrained: boolean
  justifications: AntiGamingJustification[]
  failedMetrics: string[]
}

export interface AntiGamingJustification {
  metric: 'starter_value_percentile' | 'expected_wins' | 'injury_delta' | 'trade_efficiency'
  label: string
  previousValue: number | null
  currentValue: number
  delta: number | null
  passed: boolean
}

/**
 * ⚠ EXPORTED BECAUSE 14b's FAQ RENDERS THESE NUMBERS. The handoff's build rule
 * is that the four thresholds it publishes are the actual gating logic, not
 * illustrative values, and must stay numerically in sync with this engine. The
 * FAQ imports them from here so there is no second copy to drift.
 */
export const IMPROVEMENT_THRESHOLDS = {
  starter_value_percentile: 0.02,
  expected_wins: 0.15,
  injury_delta: 0.03,
  trade_efficiency: 0.02,
}

/** Spots a team may climb week over week without a justifying improvement. */
export const MAX_UNJUSTIFIED_CLIMB = 1

export function applyAntiGamingConstraints(
  teams: AntiGamingInput[],
  previousSnapshots: Map<string, { rank: number; composite: number; metrics: SnapshotMetrics | null }>,
): AntiGamingResult[] {
  if (previousSnapshots.size === 0) {
    return teams.map(t => ({
      rosterId: t.rosterId,
      originalRank: t.currentRank,
      adjustedRank: t.currentRank,
      constrained: false,
      justifications: buildJustifications(t.metrics, null),
      failedMetrics: [],
    }))
  }

  interface TeamEntry {
    rosterId: number
    originalRank: number
    composite: number
    minAllowedRank: number
    justifications: AntiGamingJustification[]
    failedMetrics: string[]
    isConstrained: boolean
  }

  const entries: TeamEntry[] = []

  for (const team of teams) {
    const prev = previousSnapshots.get(String(team.rosterId))
    if (!prev || !prev.metrics) {
      entries.push({
        rosterId: team.rosterId,
        originalRank: team.currentRank,
        composite: team.composite,
        minAllowedRank: 1,
        justifications: buildJustifications(team.metrics, null),
        failedMetrics: [],
        isConstrained: false,
      })
      continue
    }

    const rankImprovement = prev.rank - team.currentRank
    if (rankImprovement <= 0) {
      entries.push({
        rosterId: team.rosterId,
        originalRank: team.currentRank,
        composite: team.composite,
        minAllowedRank: 1,
        justifications: buildJustifications(team.metrics, prev.metrics),
        failedMetrics: [],
        isConstrained: false,
      })
      continue
    }

    const justifications = buildJustifications(team.metrics, prev.metrics)
    const anyPassed = justifications.some(j => j.passed)
    const failedMetrics = justifications.filter(j => !j.passed).map(j => j.metric)

    if (anyPassed) {
      entries.push({
        rosterId: team.rosterId,
        originalRank: team.currentRank,
        composite: team.composite,
        minAllowedRank: 1,
        justifications,
        failedMetrics: [],
        isConstrained: false,
      })
    } else {
      entries.push({
        rosterId: team.rosterId,
        originalRank: team.currentRank,
        composite: team.composite,
        minAllowedRank: prev.rank - MAX_UNJUSTIFIED_CLIMB,
        justifications,
        failedMetrics,
        isConstrained: true,
      })
    }
  }

  entries.sort((a, b) => b.composite - a.composite)

  const results: AntiGamingResult[] = new Array(entries.length)
  const usedRanks = new Set<number>()

  const unconstrained = entries.filter(e => !e.isConstrained)
  const constrained = entries.filter(e => e.isConstrained)

  let nextUnconstrainedSlot = 1
  for (const uc of unconstrained) {
    while (usedRanks.has(nextUnconstrainedSlot)) nextUnconstrainedSlot++
    usedRanks.add(nextUnconstrainedSlot)
    const idx = entries.indexOf(uc)
    results[idx] = {
      rosterId: uc.rosterId,
      originalRank: uc.originalRank,
      adjustedRank: nextUnconstrainedSlot,
      constrained: nextUnconstrainedSlot !== uc.originalRank,
      justifications: uc.justifications,
      failedMetrics: uc.failedMetrics,
    }
    nextUnconstrainedSlot++
  }

  constrained.sort((a, b) => a.minAllowedRank - b.minAllowedRank || b.composite - a.composite)

  for (const ct of constrained) {
    let rank = ct.minAllowedRank
    while (usedRanks.has(rank)) rank++
    usedRanks.add(rank)
    const idx = entries.indexOf(ct)
    results[idx] = {
      rosterId: ct.rosterId,
      originalRank: ct.originalRank,
      adjustedRank: rank,
      constrained: rank !== ct.originalRank,
      justifications: ct.justifications,
      failedMetrics: ct.failedMetrics,
    }
  }

  return results
}

function buildJustifications(
  current: SnapshotMetrics,
  previous: SnapshotMetrics | null,
): AntiGamingJustification[] {
  if (!previous) {
    return [
      { metric: 'starter_value_percentile', label: 'Starter Value Percentile', previousValue: null, currentValue: current.starterValuePercentile, delta: null, passed: true },
      { metric: 'expected_wins', label: 'Expected Wins', previousValue: null, currentValue: current.expectedWins, delta: null, passed: true },
      { metric: 'injury_delta', label: 'Injury Health Improvement', previousValue: null, currentValue: current.injuryHealthRatio, delta: null, passed: true },
      { metric: 'trade_efficiency', label: 'Trade Efficiency', previousValue: null, currentValue: current.tradeEffPremium, delta: null, passed: true },
    ]
  }

  const starterDelta = current.starterValuePercentile - previous.starterValuePercentile
  const ewDelta = current.expectedWins - previous.expectedWins
  const injDelta = current.injuryHealthRatio - previous.injuryHealthRatio
  const tradeDelta = current.tradeEffPremium - previous.tradeEffPremium

  return [
    {
      metric: 'starter_value_percentile',
      label: 'Starter Value Percentile',
      previousValue: previous.starterValuePercentile,
      currentValue: current.starterValuePercentile,
      delta: starterDelta,
      passed: starterDelta >= IMPROVEMENT_THRESHOLDS.starter_value_percentile,
    },
    {
      metric: 'expected_wins',
      label: 'Expected Wins',
      previousValue: previous.expectedWins,
      currentValue: current.expectedWins,
      delta: ewDelta,
      passed: ewDelta >= IMPROVEMENT_THRESHOLDS.expected_wins,
    },
    {
      metric: 'injury_delta',
      label: 'Injury Health Improvement',
      previousValue: previous.injuryHealthRatio,
      currentValue: current.injuryHealthRatio,
      delta: injDelta,
      passed: injDelta >= IMPROVEMENT_THRESHOLDS.injury_delta,
    },
    {
      metric: 'trade_efficiency',
      label: 'Trade Efficiency',
      previousValue: previous.tradeEffPremium,
      currentValue: current.tradeEffPremium,
      delta: tradeDelta,
      passed: tradeDelta >= IMPROVEMENT_THRESHOLDS.trade_efficiency,
    },
  ]
}
