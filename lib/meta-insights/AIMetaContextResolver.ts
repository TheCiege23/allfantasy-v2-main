/**
 * AIMetaContextResolver – resolves meta context for AI systems (OpenAI, DeepSeek, Grok).
 * Injects trending players, strategy meta, and optional narrative for:
 * - AI draft suggestions
 * - Waiver recommendations
 * - Trade analysis
 * - Plain-language meta summaries and actionable suggestions (sport context).
 */

import { getMetaInsightsContext, formatMetaContextForPrompt } from '@/lib/ai-meta-context'
import { buildAIMetaSummary } from '@/lib/global-meta-engine/MetaAggregationPipeline'
import { resolveSportForMetaUI } from './SportMetaUIResolver'

export interface AIMetaContextPayload {
  sport: string
  promptBlob: string
  hottestPlayers: Array<{ playerId: string; trendScore: number; direction: string }>
  risingPlayers: Array<{ playerId: string; trendScore: number; direction: string }>
  fallers: Array<{ playerId: string; trendScore: number; direction: string }>
  strategyMeta: Array<{ strategyType: string; usageRate: number; successRate: number; trendingDirection: string }>
  /** Short narrative/summary for user-facing explanations (OpenAI). */
  summary?: string
  /** Top trend bullets for Grok-style narrative. */
  topTrends?: string[]
}

function buildPlayerTrendLine(
  title: string,
  rows: Array<{ playerId: string; trendScore: number; direction: string }>,
  limit = 4
): string {
  const line = rows
    .slice(0, limit)
    .map((row) => `${row.playerId} (${row.direction}, ${Math.round(row.trendScore)})`)
    .join(', ')
  return `${title}: ${line || 'none'}`
}

function buildStrategyLine(
  rows: Array<{ strategyType: string; usageRate: number; successRate: number; trendingDirection: string }>,
  limit = 3
): string {
  const line = rows
    .slice(0, limit)
    .map(
      (row) =>
        `${row.strategyType} (${Math.round(row.usageRate * 100)}% usage, ${Math.round(row.successRate * 100)}% success, ${row.trendingDirection})`
    )
    .join('; ')
  return `Strategy shifts: ${line || 'none'}`
}

export async function resolveAIMetaContextWithWindow(
  sport: string,
  timeframe: '24h' | '7d' | '30d' = '7d'
): Promise<AIMetaContextPayload> {
  const normalizedSport = resolveSportForMetaUI(sport)
  const [ctx, aiSummary] = await Promise.all([
    getMetaInsightsContext(normalizedSport),
    buildAIMetaSummary(normalizedSport, undefined, timeframe),
  ])
  const promptBlob = formatMetaContextForPrompt(ctx)
  return {
    sport: ctx.sport,
    promptBlob,
    hottestPlayers: ctx.hottestPlayers,
    risingPlayers: ctx.risingPlayers,
    fallers: ctx.fallers,
    strategyMeta: ctx.strategyMeta,
    summary: aiSummary.summary,
    topTrends: aiSummary.topTrends,
  }
}

/** Context optimized for DeepSeek quantitative modeling prompts. */
export function buildDeepSeekMetaContext(payload: AIMetaContextPayload): string {
  return [
    `SPORT: ${payload.sport}`,
    buildPlayerTrendLine('Top hottest trend scores', payload.hottestPlayers),
    buildPlayerTrendLine('Top rising trend scores', payload.risingPlayers),
    buildStrategyLine(payload.strategyMeta),
  ].join('\n')
}

/** Context optimized for Grok narrative/trend framing prompts. */
export function buildGrokMetaContext(payload: AIMetaContextPayload): string {
  const trendBullets = (payload.topTrends ?? []).slice(0, 5).join(' | ')
  return [
    `Sport context: ${payload.sport}`,
    payload.summary ? `Summary: ${payload.summary}` : 'Summary: none',
    trendBullets ? `Narrative trend bullets: ${trendBullets}` : 'Narrative trend bullets: none',
    buildPlayerTrendLine('Storyline anchors', payload.hottestPlayers, 3),
  ].join('\n')
}

/** Context optimized for OpenAI actionable recommendation prompts. */
export function buildOpenAIMetaContext(payload: AIMetaContextPayload): string {
  return [
    `Use this platform meta context for actionable recommendations in ${payload.sport}.`,
    payload.promptBlob,
    payload.summary ? `Plain-language summary: ${payload.summary}` : '',
    buildStrategyLine(payload.strategyMeta),
  ]
    .filter(Boolean)
    .join('\n')
}
