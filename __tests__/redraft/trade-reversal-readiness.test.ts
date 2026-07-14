import { describe, expect, it } from 'vitest'
import { evaluateTradeReversalReadiness, type ReversalEvidenceSnapshot } from '@/lib/league-trade-engine/tradeReversalReadiness'

const snapshot: ReversalEvidenceSnapshot = { id: 'snap-1', completeness: 'complete', seasonId: 's1', beforeState: { players: [{ playerId: 'p1', rosterId: 'r1' }], rosters: [{ id: 'r1', faabBalance: 100 }, { id: 'r2', faabBalance: 50 }], idpSalaries: [{ id: 'sal-1', playerId: 'p1', rosterId: 'r1' }] }, afterState: { players: [{ playerId: 'p1', rosterId: 'r2' }], rosters: [{ id: 'r1', faabBalance: 90 }, { id: 'r2', faabBalance: 60 }], idpSalaries: [{ id: 'sal-1', playerId: 'p1', rosterId: 'r2' }] } }

describe('trade reversal readiness', () => {
  it('blocks missing evidence and remains read-only', () => {
    expect(evaluateTradeReversalReadiness({ snapshot: null, currentSeasonId: 's1', currentPlayers: [], currentRosters: [], currentIdpSalaries: [] })).toMatchObject({ reversible: false, blockers: [{ code: 'MISSING_EXECUTION_SNAPSHOT' }] })
  })

  it('reports a clean completed snapshot as reversible', () => {
    expect(evaluateTradeReversalReadiness({ snapshot, currentSeasonId: 's1', currentPlayers: snapshot.afterState.players!, currentRosters: snapshot.afterState.rosters!, currentIdpSalaries: snapshot.afterState.idpSalaries! })).toMatchObject({ reversible: true, snapshotId: 'snap-1', blockers: [] })
  })

  it('detects later player, FAAB, salary, season, and finalized-result dependencies', () => {
    const result = evaluateTradeReversalReadiness({ snapshot, currentSeasonId: 's2', currentPlayers: [{ playerId: 'p1', rosterId: 'r3' }], currentRosters: [{ id: 'r1', faabBalance: 89 }, { id: 'r2', faabBalance: 60 }], currentIdpSalaries: [{ id: 'sal-1', playerId: 'p1', rosterId: 'r3' }], scoringPeriodFinalized: true, playoffResultFinalized: true })
    expect(result.blockers.map((row) => row.code)).toEqual(expect.arrayContaining(['PLAYER_ALREADY_MOVED', 'FAAB_ALREADY_SPENT', 'IDP_CAP_DEPENDENCY', 'CROSS_SEASON_REVERSAL_BLOCKED', 'SCORING_PERIOD_FINALIZED', 'PLAYOFF_RESULT_FINALIZED']))
  })
})
