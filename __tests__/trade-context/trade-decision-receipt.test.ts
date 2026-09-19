import { describe, expect, it } from 'vitest'

import { publicTradeDecisionReceipt } from '@/lib/league-trade-engine/tradeDecisionReceipt'

describe('public trade decision receipt', () => {
  it('exposes verification and outcome facts without private roster context', () => {
    const receipt = publicTradeDecisionReceipt({
      completeness: 'complete',
      policyVersion: 'trade-policy-2.1',
      format: 'guillotine',
      capturedAt: new Date('2026-09-19T16:00:00.000Z'),
      evidence: { as_of_asset_values: 'available', as_of_projections: 'available' },
      assetContext: { valueSource: 'FantasyCalc · redraft · 1QB', projectionSource: 'league-scored feed · week 2' },
      decisionResult: { participants: [{
        rosterId: 'r1', grade: 'A', action: 'accept', recommendation: 'Accept', reason: 'Market and survival improve.',
        valueGiven: 5000, valueReceived: 5600, valueDelta: 600, lineupPointsDelta: 2.4,
        outcomeMetric: 'survival', outcomeDeltaPct: 9, coveragePct: 100,
      }] },
      readiness: { contextualGradeAllowed: true, missingRequired: [], reason: null },
      outcomeSimulation: { verified: true, metric: 'survival', beforePct: 62, afterPct: 71, deltaPct: 9, participants: [
        { rosterId: 'r1', beforePct: 62, afterPct: 71, deltaPct: 9 },
        { rosterId: 'r2', beforePct: 75, afterPct: 66, deltaPct: -9 },
      ] },
    })
    expect(receipt).toEqual({
      completeness: 'complete', policyVersion: 'trade-policy-2.1', format: 'guillotine',
      capturedAt: '2026-09-19T16:00:00.000Z', contextualGradeAllowed: true,
      missingEvidence: [], reason: null, assetValuesVerified: true, projectionsVerified: true,
      outcomeVerified: true, outcomeMetric: 'survival', beforePct: 62, afterPct: 71, deltaPct: 9,
      valueSource: 'FantasyCalc · redraft · 1QB', projectionSource: 'league-scored feed · week 2',
      participantOutcomes: [
        { rosterId: 'r1', beforePct: 62, afterPct: 71, deltaPct: 9 },
        { rosterId: 'r2', beforePct: 75, afterPct: 66, deltaPct: -9 },
      ],
      participantDecisions: [{
        rosterId: 'r1', grade: 'A', action: 'accept', recommendation: 'Accept', reason: 'Market and survival improve.',
        valueGiven: 5000, valueReceived: 5600, valueDelta: 600, lineupPointsDelta: 2.4,
        outcomeMetric: 'survival', outcomeDeltaPct: 9, coveragePct: 100,
      }],
    })
    expect(receipt).not.toHaveProperty('rosterContext')
    expect(receipt).not.toHaveProperty('managerContext')
  })
})
