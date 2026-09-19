import { describe, expect, it, vi } from 'vitest'

import { buildTradeDecisionSnapshot, writeTradeDecisionSnapshot } from '@/lib/league-trade-engine/tradeDecisionSnapshot'

const base = () => ({
  league: {
    id: 'l1', season: 2026, sport: 'NFL', leagueType: 'redraft', leagueSize: 12,
    starters: ['QB', 'RB', 'WR', 'FLEX'], settings: { scoring_settings: { rec: 1 } },
    playoffTeams: 6, playoffStartWeek: 15, waiverBudget: 100,
  },
  rosters: [
    { id: 'r1', platformUserId: 'u1', playerData: { players: ['p1'] }, faabRemaining: 75 },
    { id: 'r2', platformUserId: 'u2', playerData: { players: ['p2'] }, faabRemaining: 40 },
  ],
  assets: [{ itemType: 'player' as const, itemReference: 'p1', fromRosterId: 'r1', toRosterId: 'r2' }],
  proposedByUserId: 'u1',
  managerStrategy: { active: 'win-now' as const, confirmedAt: new Date('2026-09-19T12:00:00.000Z') },
  tradeSettings: { tradesAllowed: true, tradeReviewMode: 'instant' },
})

describe('immutable trade-time decision snapshot', () => {
  it('freezes league, roster, asset, and manager evidence while naming missing grade inputs', () => {
    const input = base()
    const snapshot = buildTradeDecisionSnapshot(input)
    expect(snapshot).toMatchObject({
      policyVersion: 'trade-policy-2.1',
      format: 'redraft',
      completeness: 'partial',
      managerContext: { active: 'win-now' },
      evidence: { league_rules: 'available', roster_before: 'available', as_of_asset_values: 'missing', paired_outcome_simulation: 'missing' },
      readiness: { contextualGradeAllowed: false },
    })

    input.league.settings.scoring_settings.rec = 0
    input.rosters[0]!.playerData.players.push('future-player')
    expect((snapshot.leagueContext.settings as { scoring_settings: { rec: number } }).scoring_settings.rec).toBe(1)
    expect(((snapshot.rosterContext.rosters as Array<{ playerData: { players: string[] } }>)[0]!.playerData.players)).toEqual(['p1'])
  })

  it('preserves an unverified client-roundtrip simulation for audit without unlocking a grade', () => {
    const snapshot = buildTradeDecisionSnapshot({ ...base(), metadata: { projectedOutcomeDelta: 7.4 } })
    expect(snapshot.outcomeSimulation).toMatchObject({ deltaPct: 7.4, verified: false })
    expect(snapshot.evidence.paired_outcome_simulation).toBe('missing')
    expect(snapshot.readiness.contextualGradeAllowed).toBe(false)
  })

  it('unlocks the contextual receipt only from server-verified values, projections, and simulation', () => {
    const snapshot = buildTradeDecisionSnapshot({
      ...base(),
      verifiedProposalEvidence: {
        version: 1,
        leagueId: 'l1',
        proposerRosterId: 'r1',
        assetFingerprint: 'signed',
        assets: [{ itemType: 'player', itemReference: 'p1', fromRosterId: 'r1', toRosterId: 'r2', faabAmount: null, name: 'Player One', value: 5100, weeklyProjection: 15.8 }],
        managerStrategy: 'win-now',
        simulation: { available: true, metric: 'playoff', beforePct: 40, afterPct: 46, deltaPct: 6, iterations: 5000, reason: null },
        modelVersion: 'league-proposal-v3',
        valueSource: 'FantasyCalc · redraft · 1QB',
        projectionSource: 'league-scored projection feed · 2026 week 2',
        capturedAt: '2026-09-19T16:00:00.000Z',
      },
    })
    expect(snapshot.evidence).toMatchObject({
      as_of_asset_values: 'available', as_of_projections: 'available', paired_outcome_simulation: 'available',
    })
    expect(snapshot.outcomeSimulation).toMatchObject({ verified: true, deltaPct: 6 })
    expect(snapshot.readiness.contextualGradeAllowed).toBe(true)
    expect(snapshot.completeness).toBe('complete')
  })

  it('freezes a server-generated custom-trade market grade while keeping missing simulation honest', () => {
    const snapshot = buildTradeDecisionSnapshot({
      ...base(),
      serverDecisionResult: {
        modelVersion: 'trade-value-v-test', capturedAt: '2026-09-19T17:00:00.000Z', scope: 'market', evaluatorSupported: true, reason: null,
        participants: [{
          rosterId: 'r1', grade: 'A', action: 'accept', recommendation: 'Accept the value gain.',
          valueGiven: 5000, valueReceived: 6000, valueDelta: 1000, fairnessScore: 82,
          confidenceScore: 94, coverageStatus: 'complete', coveragePct: 100,
          lineupPointsBefore: 100, lineupPointsAfter: 104, lineupPointsDelta: 4,
        }],
      },
    })
    expect(snapshot.evidence).toMatchObject({ as_of_asset_values: 'available', as_of_projections: 'available', paired_outcome_simulation: 'missing' })
    expect(snapshot.completeness).toBe('partial')
    expect(snapshot.decisionResult).toMatchObject({ scope: 'market', participants: [{ rosterId: 'r1', grade: 'A' }] })
    expect(((snapshot.decisionResult as { participants: Array<{ reason: string }> }).participants[0]?.reason)).toContain('Market grade A')
  })

  it('writes one append-only row keyed to the trade instead of updating a prior receipt', async () => {
    const snapshot = buildTradeDecisionSnapshot(base())
    const create = vi.fn().mockResolvedValue({ id: 'receipt-1' })
    await writeTradeDecisionSnapshot({ tradeDecisionSnapshot: { create } } as never, {
      tradeId: 'trade-1', leagueId: 'l1', proposedByUserId: 'u1', snapshot,
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]![0].data).toMatchObject({
      tradeId: 'trade-1', leagueId: 'l1', proposedByUserId: 'u1', completeness: 'partial',
    })
  })
})
