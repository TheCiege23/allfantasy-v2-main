import { beforeEach, describe, expect, it, vi } from 'vitest'

const { evaluateCanonicalTrade } = vi.hoisted(() => ({ evaluateCanonicalTrade: vi.fn() }))
vi.mock('@/lib/decision-os/trade/canonicalEvaluator', () => ({ evaluateCanonicalTrade }))

import { evaluateServerTradeDecision } from '@/lib/league-trade-engine/serverTradeDecision'

describe('server trade decision capture', () => {
  beforeEach(() => {
    evaluateCanonicalTrade.mockReset()
    evaluateCanonicalTrade.mockImplementation(async (input: { viewerRosterId: string }) => {
      const proposer = input.viewerRosterId === 'r1'
      return {
        action: proposer ? 'accept' : 'decline',
        recommendation: proposer ? 'Accept the value gain.' : 'Decline the value loss.',
        valueGiven: proposer ? 5000 : 6000,
        valueReceived: proposer ? 6000 : 5000,
        valueDelta: proposer ? 1000 : -1000,
        fairnessScore: 82,
        confidenceScore: 94,
        coverageStatus: 'complete',
        coveragePct: 100,
        memo: { snapshot: { version: 'trade-value-v-test' } },
        rosterImpact: { startingPointsBefore: 100, startingPointsAfter: proposer ? 104 : 97, startingPointsDelta: proposer ? 4 : -3 },
      }
    })
  })

  it('recomputes a custom two-team package for both teams on the server', async () => {
    const result = await evaluateServerTradeDecision({
      leagueId: 'l1', proposerRosterId: 'r1', receiverRosterId: 'r2', participantRosterIds: ['r1', 'r2'], season: 2026,
      assets: [{ itemType: 'player', itemReference: 'p1', fromRosterId: 'r1', toRosterId: 'r2', metadata: { playerName: 'One' } }],
      capturedAt: '2026-09-19T17:00:00.000Z',
    })
    expect(evaluateCanonicalTrade).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ evaluatorSupported: true, scope: 'market', modelVersion: 'trade-value-v-test' })
    expect(result.participants).toHaveLength(2)
    expect(result.participants[0]).toMatchObject({ rosterId: 'r1', action: 'accept', valueDelta: 1000, lineupPointsDelta: 4 })
    expect(result.participants[1]).toMatchObject({ rosterId: 'r2', action: 'decline', valueDelta: -1000, lineupPointsDelta: -3 })
    expect(result.participants[0]?.grade).not.toBe(result.participants[1]?.grade)
  })

  it('withholds a multi-team market letter explicitly', async () => {
    const result = await evaluateServerTradeDecision({
      leagueId: 'l1', proposerRosterId: 'r1', receiverRosterId: 'r2', participantRosterIds: ['r1', 'r2', 'r3'], season: 2026, assets: [],
    })
    expect(result.evaluatorSupported).toBe(false)
    expect(result.participants).toEqual([])
    expect(result.reason).toContain('3-team')
  })
})
