/**
 * ToolAIEntryResolver — maps tool/surface to API routes and envelope featureType.
 * Used for UI click audit and consistent context handoff.
 */

import type { ToolAIEntryKey } from "./types"

export interface ToolAIEntry {
  key: ToolAIEntryKey
  label: string
  apiPath: string
  featureType: string
  typicalIntent: string
}

/*
 * 🛑 `psychological` and `psychological_profiles` have NO entry. Both pointed at
 * /api/leagues/[leagueId]/psychological-profiles/explain, which is retired to a constant
 * 410 (Milestone 32: manager characterisation is shown to nobody), and there is no
 * replacement to repoint them to. As of 2026-09-29 they are gone from ToolAIEntryKey too:
 * no caller typed them. The `psychological` featureType that
 * /api/leagues/[leagueId]/reputation/explain still sends is a DIFFERENT key space — the
 * ai-tool-layer's ToolContextMap and the ai-orchestration normalizer — and stays there.
 */
const TOOL_ENTRIES: Partial<Record<ToolAIEntryKey, Omit<ToolAIEntry, "key">>> = {
  trade_analyzer: {
    label: "Trade Analyzer",
    apiPath: "/api/legacy/trade/analyze",
    featureType: "trade_analyzer",
    typicalIntent: "explain",
  },
  trade_evaluator: {
    label: "Trade Evaluator",
    apiPath: "/api/trade-evaluator",
    featureType: "trade_evaluator",
    typicalIntent: "explain",
  },
  waiver_ai: {
    label: "Waiver AI",
    apiPath: "/api/waiver-ai",
    featureType: "waiver_ai",
    typicalIntent: "recommend",
  },
  rankings: {
    label: "Rankings",
    apiPath: "/api/rankings/league-v2",
    featureType: "rankings",
    typicalIntent: "explain",
  },
  draft_helper: {
    label: "Draft Helper",
    apiPath: "/api/mock-draft/ai-pick",
    featureType: "draft_helper",
    typicalIntent: "recommend",
  },
  chimmy_chat: {
    label: "Chimmy Chat",
    apiPath: "/api/chimmy",
    featureType: "chimmy_chat",
    typicalIntent: "chat",
  },
  graph_insight: {
    label: "League Graph Insight",
    apiPath: "/api/leagues/[leagueId]/graph-insight",
    featureType: "graph_insight",
    typicalIntent: "explain",
  },
  legacy_score: {
    label: "Legacy Score",
    apiPath: "/api/leagues/[leagueId]/legacy-score/explain",
    featureType: "legacy_score",
    typicalIntent: "explain",
  },
  reputation: {
    label: "Reputation",
    apiPath: "/api/leagues/[leagueId]/reputation/explain",
    featureType: "reputation",
    typicalIntent: "explain",
  },
  rivalries: {
    label: "Rivalries",
    apiPath: "/api/leagues/[leagueId]/rivalries/explain",
    featureType: "rivalries",
    typicalIntent: "explain",
  },
  awards: {
    label: "Awards",
    apiPath: "/api/leagues/[leagueId]/awards/explain",
    featureType: "awards",
    typicalIntent: "explain",
  },
  record_book: {
    label: "Record Book",
    apiPath: "/api/leagues/[leagueId]/record-book/explain",
    featureType: "record_book",
    typicalIntent: "explain",
  },
  career_prestige: {
    label: "Career Prestige",
    apiPath: "/api/career-prestige/explain",
    featureType: "career_prestige",
    typicalIntent: "explain",
  },
  xp_explain: {
    label: "XP Explain",
    apiPath: "/api/xp/explain",
    featureType: "xp_explain",
    typicalIntent: "explain",
  },
  gm_economy_explain: {
    label: "GM Economy Explain",
    apiPath: "/api/gm-economy/explain",
    featureType: "gm_economy_explain",
    typicalIntent: "explain",
  },
  bracket_intelligence: {
    label: "Bracket Intelligence",
    apiPath: "/api/bracket/intelligence/review",
    featureType: "bracket_intelligence",
    typicalIntent: "explain",
  },
  simulation: {
    label: "Simulation",
    apiPath: "/api/leagues/[leagueId]/graph-insight",
    featureType: "simulation",
    typicalIntent: "explain",
  },
  commentary: {
    label: "Commentary",
    apiPath: "/api/leagues/[leagueId]/commentary",
    featureType: "commentary",
    typicalIntent: "narrative",
  },
  story_creator: {
    label: "Story Creator",
    apiPath: "/api/leagues/[leagueId]/hall-of-fame/tell-story",
    featureType: "story_creator",
    typicalIntent: "narrative",
  },
  matchup: {
    label: "Matchup",
    apiPath: "/api/simulation/matchup",
    featureType: "matchup",
    typicalIntent: "explain",
  },
  league_matchup_ai: {
    label: "League Matchup Command AI",
    apiPath: "/api/leagues/[leagueId]/ai/matchup",
    featureType: "league_matchup_ai",
    typicalIntent: "recommend",
  },
  league_start_sit_ai: {
    label: "League Start/Sit AI",
    apiPath: "/api/leagues/[leagueId]/ai/start-sit",
    featureType: "league_start_sit_ai",
    typicalIntent: "recommend",
  },
  content: {
    label: "Content",
    apiPath: "/api/social-clips/ai/generate",
    featureType: "content",
    typicalIntent: "narrative",
  },
  openclaw_dev_assistant: {
    label: "OpenClaw Dev Assistant",
    apiPath: "/api/ai/openclaw/dev-assistant",
    featureType: "openclaw_dev_assistant",
    typicalIntent: "chat",
  },
  openclaw_growth_marketing_assistant: {
    label: "OpenClaw Growth Assistant",
    apiPath: "/api/ai/openclaw/growth-marketing-assistant",
    featureType: "openclaw_growth_marketing_assistant",
    typicalIntent: "narrative",
  },
}

/** Null for a key with no live route (see the note above TOOL_ENTRIES). */
export function getToolEntry(key: ToolAIEntryKey): ToolAIEntry | null {
  const entry = TOOL_ENTRIES[key]
  return entry ? { key, ...entry } : null
}

export function getAllToolEntries(): ToolAIEntry[] {
  return (Object.keys(TOOL_ENTRIES) as ToolAIEntryKey[])
    .map(getToolEntry)
    .filter((entry): entry is ToolAIEntry => entry != null)
}

export function getApiPathForTool(key: ToolAIEntryKey, leagueId?: string): string {
  const e = TOOL_ENTRIES[key]
  if (!e) return ""
  return e.apiPath.replace("[leagueId]", leagueId ?? "")
}
