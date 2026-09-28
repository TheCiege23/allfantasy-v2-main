import 'server-only'
import type { LeagueTradeGrader } from './leagueTradeGrader'
import type { GradeInputs } from './tradeGradeInputs'
import type { TradeGradeView } from './tradeGrade'
import { receiptGrade, type SavedTradeEvaluation } from './evaluationReceipt'
import { saveTradeEvaluationReceipt } from './evaluationReceiptStore'
import type { GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import { completedTradeInputs } from './completedTradeGrade'
import { mirrorTradeGrade } from './tradeGrade'

/** The exact email verdict, already oriented to its recipient. No price or grade is recomputed. */
export async function captureEmailEvaluation(args: {
  userId: string; leagueId: string; leagueName: string; grader: LeagueTradeGrader | null; grade: TradeGradeView | null;
  give: GradeInputs; get: GradeInputs; origin: 'pending_email' | 'completed_email';
}): Promise<SavedTradeEvaluation | null> {
  const { grader, grade } = args
  if (!grader || !grade || args.give.unpriceable.length || args.get.unpriceable.length) return null
  return saveTradeEvaluationReceipt(args.userId, {
    version: 1, model: 'trade-value-league-scoring-v1', evaluatedAt: new Date().toISOString(), sourceUpdatedAt: null, origin: args.origin,
    league: { id: args.leagueId, name: args.leagueName, sport: 'NFL', leagueType: grader.leagueType.type, leagueSize: grader.chart.leagueSize,
      scoring: null, isDynasty: grader.chart.chartIsDynasty, scoringRules: Object.fromEntries(Object.entries(grader.chart.marketCtx?.scoring.settings ?? {})
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))) },
    input: { sportFilter: 'ALL', leagueId: args.leagueId, strategy: 'neutral', teamContext: 'my_team', analysisTab: 'raw', sideGive: args.give.assets, sideGet: args.get.assets },
    grade: receiptGrade(grade), dataGaps: grade.graded ? [] : [grade.reason], sources: [], assetSources: [],
  })
}

/** Keep all receipt preparation inside an async failure boundary. Email delivery must survive it. */
export async function captureCompletedEmailEvaluation(args: {
  userId: string; leagueId: string; leagueName: string; grader: LeagueTradeGrader | null; grade: TradeGradeView | null;
  trade: GradedTrade; viewerOwnerId: string | null;
}): Promise<SavedTradeEvaluation | null> {
  if (!args.grader || !args.grade || !args.viewerOwnerId || args.trade.sides.length !== 2 || args.trade.multiTeam) return null
  const viewerSide = args.trade.sides.findIndex(side => side.ownerId != null && String(side.ownerId) === args.viewerOwnerId)
  if (viewerSide < 0) return null
  const inputs = completedTradeInputs(args.trade, new Date().getUTCFullYear())
  if (!inputs) return null
  return captureEmailEvaluation({ ...args, grade: viewerSide === 1 ? mirrorTradeGrade(args.grade) : args.grade,
    give: viewerSide === 1 ? inputs.get : inputs.give, get: viewerSide === 1 ? inputs.give : inputs.get, origin: 'completed_email' })
}
