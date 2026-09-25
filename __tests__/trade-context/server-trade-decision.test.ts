import { beforeEach, describe, expect, it, vi } from 'vitest'

const { evaluateCanonicalTrade } = vi.hoisted(() => ({ evaluateCanonicalTrade: vi.fn() }))
vi.mock('@/lib/decision-os/trade/canonicalEvaluator', () => ({ evaluateCanonicalTrade }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { evaluateServerTradeDecision } from '@/lib/league-trade-engine/serverTradeDecision'
import { gradeTrade, type TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'

/* THE grade for the proposer: 5,000 out, 6,000 in on league value — +17%, a B. */
const PROPOSER_GRADE: TradeGradeView = gradeTrade({
  giveValue: 5000,
  getValue: 6000,
  giveMarket: 5000,
  getMarket: 6000,
  unpriced: 0,
  giveCount: 1,
  getCount: 1,
  basis: 'Dynasty · 1QB · 12 teams · PPR',
  scoringApplied: false,
  needApplied: false,
  needGap: null,
  lines: [],
  moves: [],
})

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
        grade: 'A+',
        fairnessScore: 82,
        confidenceScore: 94,
        coverageStatus: 'complete',
        coveragePct: 100,
        memo: { snapshot: { version: 'trade-value-v-test' } },
        rosterImpact: { startingPointsBefore: 100, startingPointsAfter: proposer ? 104 : 97, startingPointsDelta: proposer ? 4 : -3 },
      }
    })
  })

  const run = (gradeProposal = vi.fn(async () => PROPOSER_GRADE)) =>
    evaluateServerTradeDecision({
      leagueId: 'l1', proposerRosterId: 'r1', receiverRosterId: 'r2', participantRosterIds: ['r1', 'r2'], season: 2026,
      assets: [{ itemType: 'player', itemReference: 'p1', fromRosterId: 'r1', toRosterId: 'r2', metadata: { playerName: 'One' } }],
      capturedAt: '2026-09-19T17:00:00.000Z',
      proposedByUserId: 'u1',
      gradeProposal,
    })

  it('recomputes a custom two-team package for both teams on the server', async () => {
    const result = await run()
    expect(evaluateCanonicalTrade).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ evaluatorSupported: true, scope: 'market', modelVersion: 'trade-value-v-test' })
    expect(result.participants).toHaveLength(2)
    // The lineup effect is still the canonical evaluation's.
    expect(result.participants[0]).toMatchObject({ rosterId: 'r1', lineupPointsDelta: 4 })
    expect(result.participants[1]).toMatchObject({ rosterId: 'r2', lineupPointsDelta: -3 })
  })

  /*
   * 🛑 THE RECEIPT'S LETTER IS THE ONE GRADE (2026-09-25), not `projectedLetterFor` over the
   * canonical values with the gap divided by what was given — the rule that made a card's frozen
   * "Then" disagree with what the proposer had just been shown.
   */
  it("freezes the ONE grade: the proposer's letter, and the receiver's exact mirror", async () => {
    const gradeProposal = vi.fn(async () => PROPOSER_GRADE)
    const result = await run(gradeProposal)
    expect(gradeProposal).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'l1', proposerRosterId: 'r1', proposedByUserId: 'u1' }))
    expect(result.participants[0]).toMatchObject({
      rosterId: 'r1', grade: 'B', gradeLabel: 'Slightly favors you', action: 'accept',
      valueGiven: 5000, valueReceived: 6000, valueDelta: 1000, coverageStatus: 'complete',
    })
    expect(result.participants[1]).toMatchObject({
      rosterId: 'r2', grade: 'D', gradeLabel: 'Slightly favors opponent', action: 'counter',
      valueGiven: 6000, valueReceived: 5000, valueDelta: -1000,
    })
    // Positive control: the canonical evaluation said something else, and it is not what was frozen.
    expect(result.participants.map((p) => p.grade)).not.toContain('A+')
  })

  it('a withheld grade freezes no letter, says why, and keeps the canonical action', async () => {
    const result = await run(vi.fn(async (): Promise<TradeGradeView> => ({ graded: false, reason: 'One has no value on this league’s chart.', basis: null })))
    expect(result.participants[0]).toMatchObject({
      grade: null, valueGiven: null, valueReceived: null, action: 'accept', coverageStatus: 'partial',
      gradeWithheld: 'One has no value on this league’s chart.',
    })
  })

  it('a grader that throws is a withheld grade, never a lost receipt', async () => {
    const result = await run(vi.fn(async () => { throw new Error('db down') }))
    expect(result.participants).toHaveLength(2)
    expect(result.participants[0]?.grade).toBeNull()
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
