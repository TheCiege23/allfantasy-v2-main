/**
 * ManagerBehaviorProfile aggregate — pure computation over a Manager's own
 * signal history. No storage/network access here; SnapshotStore persistence
 * and privacy gating are the Query Service's job (QueryService.ts).
 */

import type { ConfidenceEnvelope, ManagerBehaviorMetrics, Signal, SignalType } from './types'

const TRADE_TYPES: SignalType[] = ['trade_accepted', 'trade_rejected', 'trade_cancelled', 'trade_vetoed']
const WAIVER_TYPES: SignalType[] = ['waiver_claim_won', 'waiver_claim_lost']

/** Confidence scales with sample size, capped at 1 — a documented placeholder heuristic for foundation phase, not a statistically rigorous model. Reaches full confidence around 20 signals. */
function confidenceFromSampleSize(sampleSize: number): number {
  return Math.min(1, sampleSize / 20)
}

export function computeManagerBehaviorMetrics(signals: Signal[]): ManagerBehaviorMetrics {
  const trades = signals.filter((s) => TRADE_TYPES.includes(s.signalType))
  const waivers = signals.filter((s) => WAIVER_TYPES.includes(s.signalType))

  const tradeAcceptedCount = trades.filter((s) => s.signalType === 'trade_accepted').length
  const tradeRejectedCount = trades.filter((s) => s.signalType === 'trade_rejected').length
  const tradeCancelledCount = trades.filter((s) => s.signalType === 'trade_cancelled').length
  const tradeVetoedCount = trades.filter((s) => s.signalType === 'trade_vetoed').length

  const waiverWonCount = waivers.filter((s) => s.signalType === 'waiver_claim_won').length
  const waiverLostCount = waivers.filter((s) => s.signalType === 'waiver_claim_lost').length

  return {
    tradeCount: trades.length,
    tradeAcceptedCount,
    tradeRejectedCount,
    tradeCancelledCount,
    tradeVetoedCount,
    tradeAcceptRate: trades.length > 0 ? tradeAcceptedCount / trades.length : null,
    waiverClaimCount: waivers.length,
    waiverWonCount,
    waiverLostCount,
    waiverWinRate: waivers.length > 0 ? waiverWonCount / waivers.length : null,
  }
}

export function buildManagerBehaviorConfidenceEnvelope(signals: Signal[]): ConfidenceEnvelope {
  const sampleSize = signals.length
  const confidence = confidenceFromSampleSize(sampleSize)
  return {
    confidence,
    freshness: { computedAt: new Date(), isStale: false },
    evidence: signals.map((s) => ({ signalId: s.id, signalType: s.signalType })),
    sampleSize,
    sourceAttribution: signals.map((s) => s.sourceAttribution),
    // Placeholder heuristic — see module docstring on why a per-metric uncertainty
    // interval isn't computed for this multi-field profile.
    risk: 1 - confidence,
    uncertainty: null,
  }
}
