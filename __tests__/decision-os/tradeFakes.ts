// Shared fakes for Decision OS trade tests (not a test file — no DB required).
import type { TradeValueSnapshot } from '@/lib/trade-value/types'
import { resolveTradeWorld, type TradeWorld, type TradeWorldInput } from '@/lib/decision-os/trade/world'
import type { TradeWorldFacts } from '@/lib/decision-os/trade/loader'
import type { TradeAssetSummary, TradeProposalContext } from '@/lib/decision-os/trade/dco'
import type { TradeDecisionDeps } from '@/lib/decision-os/trade/decision'

export function fakeSnapshot(over: Partial<TradeValueSnapshot> = {}): TradeValueSnapshot {
  return {
    version: '1.0',
    context: { sport: 'NFL', leagueType: 'redraft', scoring: 'ppr', rosterFormat: 'standard', capturedAt: new Date().toISOString() },
    sides: [
      { rosterId: 'rosterA', total: 5200, assets: [] },
      { rosterId: 'rosterB', total: 4800, assets: [] },
    ],
    grade: { grade: 'B+', valueDifference: 400, fairnessScore: 82, confidenceScore: 90, bullets: ['Deterministic line — should be ignored by parity.'] },
    commissionerReview: { fairnessScore: 82, lopsided: false, reviewRecommended: false, similarValueRange: { low: 4600, high: 5400 } },
    ...over,
  }
}

export function fakeProposal(over: Partial<TradeProposalContext> = {}): TradeProposalContext {
  return { proposalId: 'prop-1', proposerRosterId: 'rosterA', receiverRosterId: 'rosterB', status: 'pending', vetoMode: 'commissioner', ...over }
}

export function fakeAssets(): TradeAssetSummary[] {
  return [
    { fromRosterId: 'rosterA', toRosterId: 'rosterB', assetType: 'player', playerId: 'pa', playerName: 'Player A', faabAmount: null },
    { fromRosterId: 'rosterB', toRosterId: 'rosterA', assetType: 'player', playerId: 'pb', playerName: 'Player B', faabAmount: null },
  ]
}

/** A 3-team trade graph (A→B, B→C, C→A) — exercises the multi-team / unsupported path. */
export function fakeMultiTeamAssets(): TradeAssetSummary[] {
  return [
    { fromRosterId: 'rosterA', toRosterId: 'rosterB', assetType: 'player', playerId: 'pa', playerName: 'Player A', faabAmount: null },
    { fromRosterId: 'rosterB', toRosterId: 'rosterC', assetType: 'player', playerId: 'pb', playerName: 'Player B', faabAmount: null },
    { fromRosterId: 'rosterC', toRosterId: 'rosterA', assetType: 'player', playerId: 'pc', playerName: 'Player C', faabAmount: null },
  ]
}

export function fakeWorldFacts(over: Partial<TradeWorldFacts> = {}): TradeWorldFacts {
  return {
    sport: 'NFL',
    leagueId: 'L1',
    seasonId: 'S1',
    currentWeek: 5,
    settings: { reviewType: 'commissioner', tradeReviewHours: 48, tradeDeadlineWeek: 12, draftPickTrading: false },
    proposer: { rosterId: 'rosterA', faabBalance: 60, wins: 3, losses: 2, ties: 0, pointsFor: 540, playoffSeed: 4 },
    receiver: { rosterId: 'rosterB', faabBalance: 80, wins: 4, losses: 1, ties: 0, pointsFor: 600, playoffSeed: 2 },
    ...over,
  }
}

export function fakeWorldInput(over: Partial<TradeWorldInput> = {}): TradeWorldInput {
  const f = fakeWorldFacts()
  return {
    sport: f.sport, leagueId: f.leagueId, seasonId: f.seasonId, currentWeek: f.currentWeek,
    settings: f.settings, proposer: f.proposer, receiver: f.receiver, snapshotAvailable: true, ...over,
  }
}

export function fakeWorld(over: Partial<TradeWorldInput> = {}): TradeWorld {
  return resolveTradeWorld(fakeWorldInput(over))
}

export function fakeDecisionDeps(over: Partial<TradeDecisionDeps> = {}): TradeDecisionDeps {
  const memo = fakeSnapshot()
  return { evaluate: async () => memo, ruleDeps: {}, newId: () => 'dec_test', ...over }
}
