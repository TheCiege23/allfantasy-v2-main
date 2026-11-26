import type { DecisionLogRow, DecisionLogSummary } from '@/lib/core-app/decisionLogView'

/**
 * SAMPLE decision-log rows for the /e2e/decisions harness and the screen's tests — shaped exactly as
 * GET /api/legacy/decision-log?scope=mine answers (`tradeGrade` / `tradeGradeWithheld` resolved by the
 * route from the server-written stamp). Every name, id and number here is made up.
 */
export const SAMPLE_LEAGUE_NAMES: Record<string, string> = {
  'sample-sleeper-league-1': 'Sample Dynasty League',
  'sample-sleeper-league-2': 'Sample Redraft League',
}

const day = (n: number) => new Date(Date.UTC(2026, 10, 24) - n * 86_400_000).toISOString()

export const SAMPLE_DECISIONS: DecisionLogRow[] = [
  {
    id: 'sample-d1',
    leagueId: 'sample-sleeper-league-1',
    decisionType: 'trade',
    aiRecommendation: { summary: 'Trade: accept', verdict: 'accept', oneTradeGrade: { source: 'one_trade_engine', letter: 'B+' } },
    createdAt: day(30),
    userFollowed: true,
    outcome: { outcomeGrade: 'A', evaluationWeeks: 4, rosterValueDelta: 410 },
    tradeGrade: 'B+',
    tradeGradeWithheld: null,
  },
  {
    id: 'sample-d2',
    leagueId: 'sample-sleeper-league-2',
    decisionType: 'trade',
    aiRecommendation: { summary: 'Trade: analyzed' },
    createdAt: day(12),
    userFollowed: null,
    outcome: null,
    tradeGrade: null,
    tradeGradeWithheld: 'only two-team trades are graded',
  },
  {
    id: 'sample-d3',
    leagueId: 'sample-sleeper-league-1',
    decisionType: 'waiver',
    aiRecommendation: { summary: 'Waiver: 6 suggestions (contend team)', topPick: 'Sample Running Back' },
    createdAt: day(20),
    userFollowed: false,
    outcome: { outcomeGrade: 'C', evaluationWeeks: 3, rosterValueDelta: -40 },
    tradeGrade: null,
    tradeGradeWithheld: null,
  },
  {
    id: 'sample-d4',
    leagueId: 'sample-sleeper-league-2',
    decisionType: 'trade',
    // A row logged before the stamp: its `grade` is NOT read (it may be the AI model's own letter).
    aiRecommendation: { summary: 'Trade: decline', grade: 'D' },
    createdAt: day(60),
    userFollowed: true,
    outcome: { outcomeGrade: 'B', evaluationWeeks: 3, rosterValueDelta: 120 },
    tradeGrade: null,
    tradeGradeWithheld: null,
  },
  {
    id: 'sample-d5',
    leagueId: 'sample-sleeper-league-1',
    decisionType: 'trade_proposal',
    aiRecommendation: { summary: 'Trade Proposals: 3 generated', proposalCount: 3 },
    createdAt: day(5),
    userFollowed: null,
    outcome: null,
    tradeGrade: null,
    tradeGradeWithheld: null,
  },
]

export const SAMPLE_SUMMARY: DecisionLogSummary = {
  total: 5,
  followed: 2,
  ignored: 1,
  pending: 2,
  followedWinRate: 1,
  ignoredWinRate: 0,
  avgConfidence: 0.7,
  byType: {
    trade: { total: 3, followed: 2, avgOutcome: 265 },
    waiver: { total: 1, followed: 0, avgOutcome: -40 },
    trade_proposal: { total: 1, followed: 0, avgOutcome: null },
  },
  tradeGradeCoverage: { tradeDecisions: 4, linked: 2, graded: 1 },
}

export const EMPTY_SUMMARY: DecisionLogSummary = {
  total: 0,
  followed: 0,
  ignored: 0,
  pending: 0,
  followedWinRate: 0,
  ignoredWinRate: 0,
  avgConfidence: 0,
  byType: {},
  tradeGradeCoverage: { tradeDecisions: 0, linked: 0, graded: 0 },
}
