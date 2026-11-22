import { buildAIChatHref } from "./AIContextRouter"
import { resolveSportForAIChat } from "./SportAIChatResolver"
import type { AIChatContext } from "./types"
import { getToolContextForChimmy } from "@/lib/chimmy-interface"

type ToolSource =
  | "trade"
  | "waiver"
  | "draft"
  | "matchup"
  | "playoff"
  | "lineup"
  | "generic"

type ToolBridgePayload = {
  prompt?: string
  leagueId?: string
  leagueName?: string
  sleeperUsername?: string
  insightType?: AIChatContext["insightType"]
  teamId?: string
  sport?: string
  season?: number
  week?: number
}

function toToolContextSource(source: ToolSource): Parameters<typeof getToolContextForChimmy>[0] {
  switch (source) {
    case "trade":
      return "trade"
    case "waiver":
      return "waiver"
    case "draft":
      return "draft"
    case "matchup":
      return "matchup"
    case "playoff":
      return "league_forecast"
    case "lineup":
      return "generic"
    default:
      return "generic"
  }
}

function getDefaultPromptForTool(source: ToolSource, payload: ToolBridgePayload): string {
  const routed = getToolContextForChimmy(toToolContextSource(source), payload as Record<string, unknown>)
  if (routed.suggestedPrompt?.trim()) {
    return routed.suggestedPrompt.trim()
  }
  return "I need fantasy strategy help for my team."
}

function getSourceLabel(source: ToolSource): AIChatContext["source"] {
  switch (source) {
    case "trade":
      return "trade_analyzer"
    case "waiver":
      return "waiver_tool"
    case "draft":
      return "draft_tool"
    case "matchup":
      return "matchup_tool"
    case "playoff":
      return "league_forecast"
    case "lineup":
      return "lineup_tool"
    default:
      return "unknown"
  }
}

function getDefaultInsightType(source: ToolSource): AIChatContext["insightType"] {
  switch (source) {
    case "trade":
      return "trade"
    case "waiver":
      return "waiver"
    case "draft":
      return "draft"
    case "matchup":
      return "matchup"
    case "playoff":
      return "playoff"
    default:
      return undefined
  }
}

function buildToolToAIContext(source: ToolSource, payload: ToolBridgePayload = {}): AIChatContext {
  return {
    prompt: payload.prompt?.trim() || getDefaultPromptForTool(source, payload),
    leagueId: payload.leagueId,
    leagueName: payload.leagueName,
    sleeperUsername: payload.sleeperUsername,
    insightType: payload.insightType ?? getDefaultInsightType(source),
    teamId: payload.teamId,
    sport: resolveSportForAIChat(payload.sport, null),
    season: payload.season,
    week: payload.week,
    source: getSourceLabel(source),
  }
}

export function getToolToAIChatHref(source: ToolSource, payload: ToolBridgePayload = {}): string {
  return buildAIChatHref(buildToolToAIContext(source, payload))
}
