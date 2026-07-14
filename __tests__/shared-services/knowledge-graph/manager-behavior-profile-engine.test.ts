import { describe, expect, it } from 'vitest'
import {
  buildManagerBehaviorConfidenceEnvelope,
  computeManagerBehaviorMetrics,
} from '@/lib/shared-services/knowledge-graph/ManagerBehaviorProfileEngine'
import type { Signal, SignalType } from '@/lib/shared-services/knowledge-graph/types'

function makeSignal(signalType: SignalType, managerKey = 'user-1'): Signal {
  return {
    id: Math.random().toString(),
    signalType,
    leagueId: 'league-1',
    managerKey,
    occurredAt: new Date(),
    payload: {},
    sourceAttribution: { source: 'af_native', emittedFrom: 'test', recordedAt: new Date() },
  }
}

describe('computeManagerBehaviorMetrics', () => {
  it('returns null rates and zero counts with no signal history — never a fabricated 0%', () => {
    const metrics = computeManagerBehaviorMetrics([])
    expect(metrics.tradeCount).toBe(0)
    expect(metrics.tradeAcceptRate).toBeNull()
    expect(metrics.waiverClaimCount).toBe(0)
    expect(metrics.waiverWinRate).toBeNull()
  })

  it('computes trade accept rate from a mix of outcomes', () => {
    const signals = [
      makeSignal('trade_accepted'),
      makeSignal('trade_accepted'),
      makeSignal('trade_rejected'),
      makeSignal('trade_cancelled'),
      makeSignal('trade_vetoed'),
    ]
    const metrics = computeManagerBehaviorMetrics(signals)
    expect(metrics.tradeCount).toBe(5)
    expect(metrics.tradeAcceptedCount).toBe(2)
    expect(metrics.tradeRejectedCount).toBe(1)
    expect(metrics.tradeCancelledCount).toBe(1)
    expect(metrics.tradeVetoedCount).toBe(1)
    expect(metrics.tradeAcceptRate).toBeCloseTo(2 / 5)
  })

  it('computes waiver win rate independently of trade signals', () => {
    const signals = [
      makeSignal('waiver_claim_won'),
      makeSignal('waiver_claim_won'),
      makeSignal('waiver_claim_lost'),
      makeSignal('trade_accepted'),
    ]
    const metrics = computeManagerBehaviorMetrics(signals)
    expect(metrics.waiverClaimCount).toBe(3)
    expect(metrics.waiverWonCount).toBe(2)
    expect(metrics.waiverLostCount).toBe(1)
    expect(metrics.waiverWinRate).toBeCloseTo(2 / 3)
    expect(metrics.tradeCount).toBe(1)
  })
})

describe('buildManagerBehaviorConfidenceEnvelope', () => {
  it('includes all seven confidence envelope fields', () => {
    const signals = [makeSignal('trade_accepted')]
    const envelope = buildManagerBehaviorConfidenceEnvelope(signals)
    expect(envelope).toHaveProperty('confidence')
    expect(envelope).toHaveProperty('freshness')
    expect(envelope).toHaveProperty('evidence')
    expect(envelope).toHaveProperty('sampleSize')
    expect(envelope).toHaveProperty('sourceAttribution')
    expect(envelope).toHaveProperty('risk')
    expect(envelope).toHaveProperty('uncertainty')
  })

  it('scales confidence with sample size, capped at 1', () => {
    const zero = buildManagerBehaviorConfidenceEnvelope([])
    expect(zero.confidence).toBe(0)
    expect(zero.sampleSize).toBe(0)

    const twenty = buildManagerBehaviorConfidenceEnvelope(Array.from({ length: 20 }, () => makeSignal('trade_accepted')))
    expect(twenty.confidence).toBe(1)

    const fifty = buildManagerBehaviorConfidenceEnvelope(Array.from({ length: 50 }, () => makeSignal('trade_accepted')))
    expect(fifty.confidence).toBe(1) // capped, never exceeds 1
  })

  it('evidence cites the exact signals that produced this derivation', () => {
    const signals = [makeSignal('trade_accepted'), makeSignal('waiver_claim_won')]
    const envelope = buildManagerBehaviorConfidenceEnvelope(signals)
    expect(envelope.evidence).toEqual([
      { signalId: signals[0].id, signalType: 'trade_accepted' },
      { signalId: signals[1].id, signalType: 'waiver_claim_won' },
    ])
  })

  it('source attribution is af_native for every native-signal-derived envelope, never a fabricated provider', () => {
    const envelope = buildManagerBehaviorConfidenceEnvelope([makeSignal('trade_accepted')])
    expect(envelope.sourceAttribution.every((s) => s.source === 'af_native')).toBe(true)
  })

  it('freshness marks a just-computed derivation as not stale', () => {
    const envelope = buildManagerBehaviorConfidenceEnvelope([makeSignal('trade_accepted')])
    expect(envelope.freshness.isStale).toBe(false)
    expect(envelope.freshness.computedAt).toBeInstanceOf(Date)
  })

  it('risk is the inverse of confidence (documented placeholder heuristic)', () => {
    const envelope = buildManagerBehaviorConfidenceEnvelope(Array.from({ length: 10 }, () => makeSignal('trade_accepted')))
    expect(envelope.risk).toBeCloseTo(1 - envelope.confidence)
  })

  it('does not fabricate a per-metric uncertainty band for a multi-metric profile', () => {
    const envelope = buildManagerBehaviorConfidenceEnvelope([makeSignal('trade_accepted')])
    expect(envelope.uncertainty).toBeNull()
  })
})
