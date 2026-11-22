/**
 * AI Meta Context — injects platform meta (player trends, strategy meta) into AI prompts.
 * Use from waiver-ai, draft assistant, trade analyzer, and chat so models get:
 * - Hottest / rising / fallers
 * - Strategy popularity and success rates
 */

import { getHottestPlayers, getRisingPlayers, getFallers } from "@/lib/player-trend"
import { getStrategyMetaReports } from "@/lib/strategy-meta"

interface MetaInsightsContext {
  sport: string
  /** Top trending player ids and direction (for "fastest rising waiver adds") */
  hottestPlayers: Array<{ playerId: string; trendScore: number; direction: string }>
  risingPlayers: Array<{ playerId: string; trendScore: number; direction: string }>
  fallers: Array<{ playerId: string; trendScore: number; direction: string }>
  /** Strategy meta for draft/roster narrative */
  strategyMeta: Array<{
    strategyType: string
    usageRate: number
    successRate: number
    trendingDirection: string
  }>
  /** When this context was fetched */
  fetchedAt: string
}

/**
 * Fetch meta context for a sport (server-side; use in API routes for AI).
 * Calls trend and strategy meta libs directly — no HTTP.
 */
export async function getMetaInsightsContext(sport: string): Promise<MetaInsightsContext> {
  const limit = 15
  const [hottest, rising, fallers, strategyMeta] = await Promise.all([
    getHottestPlayers({ sport, limit }),
    getRisingPlayers({ sport, limit }),
    getFallers({ sport, limit }),
    getStrategyMetaReports({ sport }),
  ])

  return {
    sport,
    hottestPlayers: hottest.map((p) => ({
      playerId: p.playerId,
      trendScore: p.trendScore,
      direction: p.trendingDirection,
    })),
    risingPlayers: rising.map((p) => ({
      playerId: p.playerId,
      trendScore: p.trendScore,
      direction: p.trendingDirection,
    })),
    fallers: fallers.map((p) => ({
      playerId: p.playerId,
      trendScore: p.trendScore,
      direction: p.trendingDirection,
    })),
    strategyMeta: strategyMeta.map((s) => ({
      strategyType: s.strategyType,
      usageRate: s.usageRate,
      successRate: s.successRate,
      trendingDirection: s.trendingDirection,
    })),
    fetchedAt: new Date().toISOString(),
  }
}

/** Build a short text blob for AI prompt injection (waiver/draft/trade). */
export function formatMetaContextForPrompt(ctx: MetaInsightsContext): string {
  const lines: string[] = [
    `Platform meta (${ctx.sport}, ${ctx.fetchedAt}):`,
    `- Hottest players (trend): ${ctx.hottestPlayers.slice(0, 5).map((p) => `${p.playerId} (${p.direction})`).join(", ") || "none"}`,
    `- Fastest rising: ${ctx.risingPlayers.slice(0, 5).map((p) => `${p.playerId} (${p.direction})`).join(", ") || "none"}`,
    `- Biggest fallers: ${ctx.fallers.slice(0, 3).map((p) => p.playerId).join(", ") || "none"}`,
    `- Strategy meta: ${ctx.strategyMeta.slice(0, 4).map((s) => `${s.strategyType} ${Math.round(s.usageRate * 100)}% usage, ${Math.round(s.successRate * 100)}% success`).join("; ") || "none"}`,
  ]
  return lines.join("\n")
}

