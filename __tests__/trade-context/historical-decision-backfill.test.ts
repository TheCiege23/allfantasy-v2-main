import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { buildHistoricalDecisionBackfill } from '@/lib/league-trade-engine/historicalDecisionBackfill'

const trade = {
  id: 'old-1', leagueId: 'league-1', proposedByUserId: 'user-1', proposerRosterId: 'r1', receiverRosterId: 'r2',
  status: 'processed', createdAt: new Date('2023-09-10T12:00:00Z'), items: [],
}

describe('historical decision recovery', () => {
  it('recovers an archived market grade while clearly withholding unavailable league context', () => {
    const snapshot = buildHistoricalDecisionBackfill({
      trade,
      offer: {
        createdAt: trade.createdAt,
        assetsGiven: [{ value: 100 }], assetsReceived: [{ value: 125 }], grade: 'A', confidenceScore: 72,
        modelVersion: 'legacy-v2', leagueFormat: 'dynasty', scoringType: 'ppr', driversJson: {},
      },
      execution: null,
    })
    expect(snapshot.completeness).toBe('partial')
    expect(snapshot.readiness).toMatchObject({ marketGradeAllowed: true, contextualGradeAllowed: false })
    expect(snapshot.decisionResult.participants[0]).toMatchObject({ rosterId: 'r1', grade: 'A' })
    expect(snapshot.decisionResult.participants[0].reason).toContain('Original contextual grade unavailable')
  })

  it('does not invent an original grade when archived proposal values are absent', () => {
    const snapshot = buildHistoricalDecisionBackfill({ trade, offer: null, execution: null })
    expect(snapshot.readiness.marketGradeAllowed).toBe(false)
    expect(snapshot.decisionResult.participants.every((side) => side.grade == null)).toBe(true)
    expect(snapshot.decisionResult.participants[0].reason).toContain('Original contextual grade unavailable')
  })

  it('keeps every manager in an older multi-team trade without inventing a third-side grade', () => {
    const snapshot = buildHistoricalDecisionBackfill({
      trade: { ...trade, items: [{ itemType: 'player', itemReference: 'p1', fromRosterId: 'r3', toRosterId: 'r1', faabAmount: null, metadata: {} }] },
      offer: {
        createdAt: trade.createdAt,
        assetsGiven: [{ value: 100 }], assetsReceived: [{ value: 110 }], grade: 'B', confidenceScore: 60,
        modelVersion: 'legacy-v2', leagueFormat: 'tournament', scoringType: 'ppr', driversJson: {},
      },
      execution: null,
    })
    expect(snapshot.decisionResult.participants.map((side) => side.rosterId)).toEqual(['r1', 'r2', 'r3'])
    expect(snapshot.decisionResult.participants[2]).toMatchObject({ grade: null, valueGiven: null, valueReceived: null })
  })
})
