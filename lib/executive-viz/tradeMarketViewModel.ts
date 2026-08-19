/**
 * Fantasy OS Suite — Phase V2.4: Trade OS Executive Analytics Workspace.
 *
 * Provider-agnostic view models for the Trade OS flagship (Trade Opportunity Matrix) and its supporting
 * graphs. Trade OS represents the MARKET, not a player calculator. Built purely from data already loaded
 * by the hub — `LeagueAnalyticsSnapshot` (`activity.tradeCount` + activity `trend`) and the trade-category
 * Phase 6.4 `Recommendation`s from `ManagerIntelligencePayload.recommendations`. No new Decision OS logic,
 * no new fetch/contract, no raw provider/trade payloads, no player-level records, no provider identifiers.
 *
 * Step 1 audit outcome: there is NO provider-agnostic contract for position surplus/need or player-value
 * opportunity scoring (those live only in the AI trade engine over raw roster/player data — out of scope,
 * and player-centric). So the Opportunity Matrix represents OPPORTUNITIES (real trade recommendations
 * positioned by their own value × confidence), never raw player values, and "Position Demand" is deferred
 * rather than fabricated. The dedicated `CommissionerTradeReviewV1` market contract is feature-flag-gated
 * (`COMMISSIONER_TRADE_REVIEW_ENABLED`, default off), so it is not used as the always-on source here.
 */
import type { LeagueAnalyticsSnapshot } from '@/lib/decision-os/leagueAnalytics'
import type { Recommendation, RecommendationPriority, RecommendationCategory } from '@/lib/decision-os/phase6/recommendations/types'
import type { ExecutiveHealthStatus, ExecutiveBarDatum, ExecutiveSupportingChart } from './commissionerLeagueHealthViewModel'
import { PRIORITY_RANK, statusFromPriority, titleCase } from './recommendationPresentation'

const TRADE_CATEGORIES = new Set<RecommendationCategory>(['trade_coaching', 'trade_activation'])

function tradeRecommendations(recommendations: Recommendation[] | null | undefined): Recommendation[] {
  if (!recommendations) return []
  return recommendations.filter((r) => TRADE_CATEGORIES.has(r.category))
}

function marketActivityLevel(tradeCount: number): 'quiet' | 'moderate' | 'active' {
  if (tradeCount >= 5) return 'active'
  if (tradeCount >= 1) return 'moderate'
  return 'quiet'
}

// ─── Flagship: Trade Opportunity Matrix ────────────────────────────────────────

export type TradeQuadrant = 'pursue_now' | 'investigate' | 'easy_win' | 'monitor'

export type TradeOpportunity = {
  key: string
  label: string
  detail: string
  priorityLabel: string
  confidenceLabel: string
  quadrant: TradeQuadrant
  status: ExecutiveHealthStatus
}

export type TradeOpportunityMatrixViewModel = {
  available: boolean
  opportunities: TradeOpportunity[]
  quadrantCounts: Record<TradeQuadrant, number>
  marketActivity: 'quiet' | 'moderate' | 'active'
  tradeCount: number
  headline: string
}

export const TRADE_QUADRANT_LABEL: Record<TradeQuadrant, string> = {
  pursue_now: 'Pursue now',
  investigate: 'Investigate',
  easy_win: 'Easy wins',
  monitor: 'Monitor',
}

/** High value = critical/high priority; high confidence = high confidence. Quadrant = value × confidence. */
function quadrantFor(priority: RecommendationPriority, confidence: Recommendation['confidence']): TradeQuadrant {
  const highValue = priority === 'critical' || priority === 'high'
  const highConfidence = confidence === 'high'
  if (highValue && highConfidence) return 'pursue_now'
  if (highValue && !highConfidence) return 'investigate'
  if (!highValue && highConfidence) return 'easy_win'
  return 'monitor'
}

export function buildTradeOpportunityMatrix(
  recommendations: Recommendation[] | null | undefined,
  analytics: LeagueAnalyticsSnapshot | null | undefined,
): TradeOpportunityMatrixViewModel {
  const tradeCount = analytics && analytics.available ? analytics.activity.tradeCount : 0
  const marketActivity = marketActivityLevel(tradeCount)
  const trades = tradeRecommendations(recommendations)

  const opportunities: TradeOpportunity[] = [...trades]
    .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])
    .map((rec) => ({
      key: rec.id,
      label: titleCase(rec.category),
      detail: rec.recommendedActions[0]?.action || rec.expectedImpact || 'Review this opportunity.',
      priorityLabel: titleCase(rec.priority),
      confidenceLabel: `${titleCase(rec.confidence)} confidence`,
      quadrant: quadrantFor(rec.priority, rec.confidence),
      status: statusFromPriority(rec.priority),
    }))

  const quadrantCounts: Record<TradeQuadrant, number> = { pursue_now: 0, investigate: 0, easy_win: 0, monitor: 0 }
  for (const o of opportunities) quadrantCounts[o.quadrant] += 1

  const headline =
    opportunities.length === 0
      ? `No trade opportunities have surfaced yet; the market is ${marketActivity}.`
      : quadrantCounts.pursue_now > 0
        ? `${quadrantCounts.pursue_now} ${quadrantCounts.pursue_now === 1 ? 'opportunity is' : 'opportunities are'} worth pursuing now (${opportunities.length} total).`
        : `${opportunities.length} trade ${opportunities.length === 1 ? 'opportunity' : 'opportunities'} to weigh; none are high-value + high-confidence yet.`

  return {
    // The matrix is a real surface even with zero opportunities (it shows the empty market honestly).
    available: Boolean(analytics),
    opportunities,
    quadrantCounts,
    marketActivity,
    tradeCount,
    headline,
  }
}

// ─── Supporting: Market Activity ───────────────────────────────────────────────

export type TradeMarketActivityViewModel = {
  available: boolean
  activity: 'quiet' | 'moderate' | 'active'
  tradeCount: number
  direction: 'increasing' | 'decreasing' | 'flat' | null
  status: ExecutiveHealthStatus
  headline: string
}

export function buildTradeMarketActivity(
  analytics: LeagueAnalyticsSnapshot | null | undefined,
): TradeMarketActivityViewModel {
  if (!analytics || !analytics.available) {
    return { available: false, activity: 'quiet', tradeCount: 0, direction: null, status: 'unavailable', headline: 'Trade market activity appears once this league is connected and synced.' }
  }
  const tradeCount = analytics.activity.tradeCount
  const activity = marketActivityLevel(tradeCount)
  const direction = analytics.trend.available ? analytics.trend.direction : null
  const status: ExecutiveHealthStatus = activity === 'active' ? 'excellent' : activity === 'moderate' ? 'healthy' : 'watch'
  const dirPart = direction ? ` League activity is ${direction}.` : ''
  const headline =
    activity === 'quiet'
      ? `The trade market is quiet — ${tradeCount} trades so far.${dirPart}`
      : `The trade market is ${activity} — ${tradeCount} trades so far.${dirPart}`
  return { available: true, activity, tradeCount, direction, status, headline }
}

// ─── Supporting: Trade Pipeline ────────────────────────────────────────────────

export type TradePipelineItem = {
  key: string
  label: string
  detail: string
  priorityLabel: string
  status: ExecutiveHealthStatus
}

export function buildTradePipeline(
  recommendations: Recommendation[] | null | undefined,
): ExecutiveSupportingChart<TradePipelineItem> {
  const trades = tradeRecommendations(recommendations)
  if (trades.length === 0) {
    return { headline: 'No trade recommendations are open right now.', items: [], available: true }
  }
  const items: TradePipelineItem[] = [...trades]
    .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])
    .slice(0, 6)
    .map((rec) => ({
      key: rec.id,
      label: titleCase(rec.category),
      detail: rec.recommendedActions[0]?.action || rec.expectedImpact || 'Review this opportunity.',
      priorityLabel: titleCase(rec.priority),
      status: statusFromPriority(rec.priority),
    }))
  const critical = trades.filter((r) => r.priority === 'critical' || r.priority === 'high').length
  const headline =
    critical > 0
      ? `Start with ${critical} high-priority trade ${critical === 1 ? 'move' : 'moves'}.`
      : `${items.length} trade ${items.length === 1 ? 'move' : 'moves'} to weigh, in priority order.`
  return { headline, items, available: true }
}

/** Quadrant occupancy as bars — a compact "where do the opportunities sit" companion to the matrix. */
export function tradeQuadrantBars(model: TradeOpportunityMatrixViewModel): ExecutiveBarDatum[] {
  const order: TradeQuadrant[] = ['pursue_now', 'investigate', 'easy_win', 'monitor']
  const toneByQuadrant: Record<TradeQuadrant, ExecutiveHealthStatus> = {
    pursue_now: 'excellent',
    investigate: 'watch',
    easy_win: 'healthy',
    monitor: 'unavailable',
  }
  return order
    .map((q): ExecutiveBarDatum => ({
      key: q,
      label: TRADE_QUADRANT_LABEL[q],
      value: model.quadrantCounts[q],
      status: toneByQuadrant[q],
      valueLabel: `${model.quadrantCounts[q]}`,
    }))
    .filter((b) => b.value > 0)
}

/** Exposed so a test can assert Trade OS's position-supply / player-value analytics are deliberately
 * deferred rather than fabricated — parity with the Waiver/Draft/Platform deferred markers. */
export const TRADE_POSITION_ANALYTICS_DEFERRED = {
  deferred: true,
  reason:
    'Position surplus/need and player-value opportunity scoring exist only in the AI trade engine over raw roster/player data (out of scope, player-centric), and the dedicated CommissionerTradeReviewV1 market contract is feature-flag-gated (COMMISSIONER_TRADE_REVIEW_ENABLED, default off); surfacing either would require backend expansion or fabrication.',
} as const
