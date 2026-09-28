import type { SupportedSport } from "@/lib/sport-scope"
import type { ChimmyOrchestrationMeta } from "@/lib/chimmy-orchestration/types"
import type { ChimmyAssistantMode } from "@/lib/chimmy-chat/assistant-mode"
import type { ChimmyAnswerContract } from "@/lib/chimmy-chat/response-contract"

export type { ChimmyAnswerContract }

export type AIInsightType = "matchup" | "playoff" | "dynasty" | "trade" | "waiver" | "draft"

export type AIContextSource =
  | "messages_ai"
  | "messages_dm_ai"
  | "trade_analyzer"
  | "waiver_tool"
  | "draft_tool"
  | "matchup_tool"
  | "league_forecast"
  | "lineup_tool"
  | "dashboard"
  | "dashboard_widget"
  | "dashboard_rankings"
  | "tool_hub"
  | "ai_hub"
  | "quick_action"
  | "top_bar"
  | "right_rail"
  | "search"
  | "fallback"
  | "unknown"
  | "war_room"
  | "injury_impact"
  | "injury_player"
  | "matchup_prep"
  | "power_rankings"
  | "power_rankings_team"
  | "long_term_coaching"

export type AIChatContext = {
  prompt?: string
  leagueId?: string
  leagueName?: string
  /** When `all`, server pulls multi-sport injury/news digest (see Chimmy sport filter UI). */
  sportScope?: "all"
  sleeperUsername?: string
  insightType?: AIInsightType
  teamId?: string
  sport?: SupportedSport
  leagueFormat?: string
  scoring?: string
  season?: number
  week?: number
  conversationId?: string
  sessionId?: string
  privateMode?: boolean
  targetUsername?: string
  strategyMode?: string
  assistantMode?: ChimmyAssistantMode
  source?: AIContextSource
  /** Injected server Time Engine snapshot when available (never trust device clock alone). */
  afTimeContext?: Record<string, unknown> | null
  memory?: {
    tone?: string
    detailLevel?: string
    riskMode?: string
  }
}

export type ChimmyProviderStatus = Record<string, string> | undefined

/** Optional UI labels for structured Chimmy cards (default: evidence-style copy). */
export type ChimmyResponseSectionTitles = {
  shortAnswer?: string
  whatDataSays?: string
  whatItMeans?: string
  recommendedAction?: string
  caveats?: string
}

export type ChimmyResponseStructure = {
  shortAnswer: string
  whatDataSays?: string
  whatItMeans?: string
  recommendedAction?: string
  caveats?: string[]
  /** When set (e.g. orchestration-shaped replies), overrides section headings. */
  sectionTitles?: ChimmyResponseSectionTitles
}

export type ChimmyMessageMeta = {
  mode?: ChimmyAssistantMode
  answerContract?: ChimmyAnswerContract
  confidencePct?: number
  providerStatus?: ChimmyProviderStatus
  recommendedTool?: string
  /** The tools the answer used, in order (tool-loop answers only) — what a thumbs up or down is about. */
  toolsUsed?: string[]
  /** Central routing + tool launches from Chimmy orchestration brain */
  orchestration?: ChimmyOrchestrationMeta | null
  dataSources?: string[]
  syncFreshness?: {
    referenceTimezone?: string
    sportsDigest?: {
      overallLastSyncedAt?: string | null
      perSource?: Record<string, string | null>
    }
  }
  quantData?: Record<string, unknown>
  trendData?: Record<string, unknown>
  responseStructure?: ChimmyResponseStructure
  sourceLinks?: { label: string; href: string }[]
  variant?: "premium_gate" | "error"
  ctaLabel?: string
  ctaHref?: string
  /**
   * Confirm cards for a lineup change or trade offer Chimmy PREPARED — nothing has happened until
   * the user taps Confirm (`components/chimmy/ChimmyActionCard.tsx`). Validated by
   * `readActionCards`; see lib/chimmy-chat/actionCards.ts.
   */
  actionCards?: import("@/lib/chimmy/actions/types").ChimmyActionCard[]
}

export type ChimmyThreadMessage = {
  role: "user" | "assistant"
  content: string
  imageUrl?: string | null
  meta?: ChimmyMessageMeta | null
}
