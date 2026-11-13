/**
 * TradeToAIContextBridge — route from Trade Analyzer into AI Chat with optional context.
 */

import { getToolToAIChatHref } from "@/lib/chimmy-chat"
import { normalizeToSupportedSport } from "@/lib/sport-scope"

type AIChatContextOptions = {
  leagueId?: string
  insightType?: 'matchup' | 'playoff' | 'dynasty' | 'trade' | 'waiver' | 'draft'
  teamId?: string
  sport?: string
  season?: number
  week?: number
}

/**
 * URL to open AI Chat from Trade Analyzer with optional contextual metadata.
 */
export function getTradeAnalyzerAIChatUrl(suggestedPrompt?: string, options?: AIChatContextOptions): string {
  const normalizedSport = options?.sport ? normalizeToSupportedSport(options.sport) : undefined

  return getToolToAIChatHref("trade", {
    prompt: suggestedPrompt,
    leagueId: options?.leagueId,
    insightType: options?.insightType,
    teamId: options?.teamId,
    sport: normalizedSport,
    season: options?.season,
    week: options?.week,
  })
}

