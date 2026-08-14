/**
 * ProfileLabelResolver — maps behavior signals to evidence-based profile labels.
 * Labels are configurable and derived from thresholds.
 */

import type { ProfileLabel } from './types'
import type { BehaviorSignalsOutput } from './BehaviorSignalAggregator'
import { evaluateAllDimensions, type PsychDimension } from './ProfileEvidenceFloor'

export interface LabelThresholds {
  tradeHeavyMinTrades: number
  waiverFocusedMinClaims: number
  aggressiveMinScore: number
  conservativeMaxTrade: number
  rookieHeavyMinRate: number
  winNowMinContention: number
  rebuildMinScore: number
  chaosMinActivity: number
  quietStrategistMaxActivity: number
  valueFirstMinTradeTiming: number
  riskAverseMaxRisk: number
}

const DEFAULT_THRESHOLDS: LabelThresholds = {
  tradeHeavyMinTrades: 6,
  waiverFocusedMinClaims: 12,
  aggressiveMinScore: 55,
  conservativeMaxTrade: 2,
  rookieHeavyMinRate: 55,
  winNowMinContention: 50,
  rebuildMinScore: 50,
  chaosMinActivity: 60,
  quietStrategistMaxActivity: 38,
  valueFirstMinTradeTiming: 35,
  riskAverseMaxRisk: 35,
}

/**
 * Which evidence stream each label actually rests on.
 *
 * A label may only be emitted when ITS dimension cleared the evidence floor.
 * Without this, the quiet archetypes fire on emptiness: every threshold for
 * `conservative` and `quiet strategist` is an upper bound, so a manager with no
 * recorded activity satisfies all of them and gets a personality he never
 * demonstrated. Measured before this gate:
 *
 *   zero trades, zero claims, zero picks -> ["conservative", "quiet strategist"]
 */
const LABEL_DIMENSION: Record<ProfileLabel, PsychDimension> = {
  'trade-heavy': 'trade',
  aggressive: 'trade',
  conservative: 'trade',
  'value-first': 'trade',
  'win-now': 'trade',
  'patient rebuilder': 'trade',
  'waiver-focused': 'roster',
  'chaos agent': 'roster',
  'quiet strategist': 'roster',
  'rookie-heavy': 'draft',
} as Record<ProfileLabel, PsychDimension>

/**
 * Resolve profile labels from aggregated behavior signals.
 *
 * Labels are filtered by evidence: a dimension with too little recorded
 * behaviour yields NO labels for that dimension rather than the ones absence
 * happens to satisfy. An unobserved manager returns an empty array, which
 * callers must render as "not enough activity yet" — never as a personality.
 */
export function resolveProfileLabels(
  signals: BehaviorSignalsOutput,
  thresholds: Partial<LabelThresholds> = {}
): ProfileLabel[] {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds }
  const labels: ProfileLabel[] = []
  const activity = (signals.tradeFrequencyNorm + signals.waiverFocusNorm + signals.lineupChangeRate) / 3

  if (signals.tradeCount >= t.tradeHeavyMinTrades) labels.push('trade-heavy')
  if (signals.waiverClaimCount >= t.waiverFocusedMinClaims) labels.push('waiver-focused')
  if (signals.aggressionNorm >= t.aggressiveMinScore || signals.tradeTimingLateRate >= 60) labels.push('aggressive')
  if (
    signals.tradeCount <= t.conservativeMaxTrade &&
    signals.waiverFocusNorm < 30 &&
    signals.riskNorm <= t.riskAverseMaxRisk
  ) {
    labels.push('conservative')
  }
  if (
    signals.tradeCount <= 3 &&
    signals.aggressionNorm < 40 &&
    activity <= t.quietStrategistMaxActivity
  ) {
    labels.push('quiet strategist')
  }
  if (activity >= t.chaosMinActivity && signals.riskNorm >= 60 && signals.lineupChangeRate >= 45) {
    labels.push('chaos agent')
  }
  if (
    signals.rebuildScore < 30 &&
    signals.contentionScore >= 30 &&
    signals.tradeTimingLateRate >= t.valueFirstMinTradeTiming
  ) {
    labels.push('value-first')
  }
  if (signals.rookieAcquisitionRate >= t.rookieHeavyMinRate) labels.push('rookie-heavy')
  if (signals.contentionScore >= t.winNowMinContention && signals.tradeTimingLateRate >= 30) labels.push('win-now')
  if (signals.rebuildScore >= t.rebuildMinScore && signals.rookieAcquisitionRate >= 40) labels.push('patient rebuilder')

  // Evidence gate. Keep only labels whose own dimension was actually observed.
  const evidence = evaluateAllDimensions(signals)
  const gated = [...new Set(labels)].filter((label) => {
    const dimension = LABEL_DIMENSION[label]
    // An unmapped label is not silently trusted; it is dropped.
    if (!dimension) return false
    return evidence[dimension].sufficient
  })

  return gated
}

/**
 * Compute numeric scores 0–100 for profile dimensions from signals.
 */
export function resolveScores(signals: BehaviorSignalsOutput): {
  aggressionScore: number
  activityScore: number
  tradeFrequencyScore: number
  waiverFocusScore: number
  riskToleranceScore: number
} {
  return {
    aggressionScore: Math.min(100, Math.round(signals.aggressionNorm)),
    activityScore: Math.min(
      100,
      Math.round((signals.tradeFrequencyNorm + signals.waiverFocusNorm + signals.lineupChangeRate) / 3)
    ),
    tradeFrequencyScore: Math.min(100, Math.round(signals.tradeFrequencyNorm)),
    waiverFocusScore: Math.min(100, Math.round(signals.waiverFocusNorm)),
    riskToleranceScore: Math.min(100, Math.round(signals.riskNorm)),
  }
}

export { DEFAULT_THRESHOLDS }
