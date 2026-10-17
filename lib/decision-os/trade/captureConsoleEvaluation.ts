import 'server-only'
import type { TradeConsoleAnalyzeInput, TradeConsoleAnalyzeResult } from '@/lib/trade-value-console/types'
import { receiptGrade, receiptScoringRules, type SavedTradeEvaluation } from './evaluationReceipt'
import { saveTradeEvaluationReceipt } from './evaluationReceiptStore'

/** Capture the result already computed by the shared grader, never reload prices to reconstruct it. */
export async function captureConsoleEvaluation(input: TradeConsoleAnalyzeInput, result: TradeConsoleAnalyzeResult,
  notes?: { byeNotes: string[]; formatNotes: string[] }): Promise<SavedTradeEvaluation | null> {
  if (!input.userId || !result.league || result.analysisMode !== 'league') return null
  const league = result.league
  return saveTradeEvaluationReceipt(input.userId, {
    version: 1, model: 'trade-value-league-scoring-v1', evaluatedAt: result.lastUpdated ?? new Date().toISOString(),
    // The console's lastUpdated is assigned at analysis time, not read from a provider.
    sourceUpdatedAt: null, origin: 'calculator',
    league: { id: league.id, name: league.name, sport: league.sport, leagueType: league.leagueType, leagueSize: league.leagueSize,
      scoring: league.scoring, isDynasty: league.isDynasty, scoringRules: receiptScoringRules(league.settings) },
    input: { sportFilter: input.sportFilter, leagueId: league.id, strategy: input.strategy, teamContext: input.teamContext,
      analysisTab: input.analysisTab, sideGive: input.sideGive, sideGet: input.sideGet, opponentTeamExternalId: input.opponentTeamExternalId ?? null },
    grade: receiptGrade(result.grade), dataGaps: result.dataGaps, sources: result.dataSources,
    ...(notes ? { contextNotes: { byeNotes: notes.byeNotes, formatNotes: notes.formatNotes } } : {}),
    assetSources: (['give', 'get'] as const).flatMap(side => result.players[side].map((line, index) => ({
      side, index, source: line.pricedSource, playerId: line.playerId, position: line.position,
    }))),
  })
}
