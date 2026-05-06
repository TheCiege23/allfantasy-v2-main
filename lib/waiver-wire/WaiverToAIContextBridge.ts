/**
 * WaiverToAIContextBridge — route from Waiver Wire into AI Chat with optional context.
 */

import { getToolToAIChatHref } from "@/lib/chimmy-chat"
import type { UnifiedPlayerWireDto } from "@/lib/player-data/serializeUnifiedPlayerForApi"
import { buildAiUnifiedPlayerBullets } from "@/lib/player-data/adapters/aiPlayerContextAdapter"

type AIChatContextOptions = {
  leagueId?: string
  insightType?: 'matchup' | 'playoff' | 'dynasty' | 'trade' | 'waiver' | 'draft'
  teamId?: string
  sport?: string
  season?: number
  week?: number
}

type WaiverSummaryContext = {
  waiverType?: string | null
  pendingClaims?: number
  watchlistCount?: number
  topTargets?: string[]
}

/**
 * URL to open AI Chat (Legacy). Optionally pass a suggested prompt for waiver discussion.
 */
export function getWaiverAIChatUrl(suggestedPrompt?: string, options?: AIChatContextOptions): string {
  return getToolToAIChatHref("waiver", {
    prompt: suggestedPrompt,
    leagueId: options?.leagueId,
    insightType: options?.insightType,
    teamId: options?.teamId,
    sport: options?.sport,
    season: options?.season,
    week: options?.week,
  })
}

/**
 * Build a short suggested prompt for waiver help in AI context.
 */
export function buildWaiverSummaryForAI(
  leagueContext?: string,
  sport?: string,
  context?: WaiverSummaryContext
): string {
  const parts = ["I'm managing my waiver wire"]
  if (sport) parts.push(`for ${sport}`)
  if (leagueContext) parts.push(`(${leagueContext})`)
  if (context?.waiverType) parts.push(`using ${context.waiverType} rules`)
  if (typeof context?.pendingClaims === "number") parts.push(`with ${context.pendingClaims} pending claims`)
  if (typeof context?.watchlistCount === "number") parts.push(`and ${context.watchlistCount} watchlist targets`)
  if (context?.topTargets && context.topTargets.length > 0) {
    parts.push(`Top targets: ${context.topTargets.slice(0, 3).join(", ")}`)
  }
  parts.push(". Can you suggest priority adds, FAAB bids, drops, and fallback contingencies?")
  return parts.join(" ")
}

/**
 * Compact deterministic bullet list from waiver pool unified rows (for prompts / tool context).
 */
export function formatWaiverWireUnifiedForPrompt(players: UnifiedPlayerWireDto[], max = 6): string {
  return buildAiUnifiedPlayerBullets(players, max)
}
