/**
 * AllFantasy Universal AI Engine — Core Types
 *
 * Every sport/feature in the platform plugs into this contract.
 * The engine calls plugin steps in order:
 *
 *   1. fetchContext        — DB queries for pool/league/entry data
 *   2. fetchProviderData   — live/cached sports provider data
 *   3. computeInsights     — ALL math/scoring/ranking (NO AI)
 *   4. buildGroundingPacket — single JSON object sent to the LLM
 *   5. [engine calls AI]   — narrative/tone only, never math
 *   6. validateResponse    — sport-specific sanitization
 *
 * Callers pass AIEngineInput; callers receive AIEngineOutput.
 * Sport plugins implement SportPlugin<TContext, TProviderData, TInsights>.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Identifiers
// ─────────────────────────────────────────────────────────────────────────────

export type SportKey =
  | "world_cup"
  | "nfl"
  | "nba"
  | "mlb"
  | "nhl"
  | "epl"
  | "soccer" // generic soccer / non-WC
  | "march_madness"
  | "ufc"
  | "aew"
  | "pickem"
  | "survivor"
  | "bracket" // generic bracket
  | "commissioner" // cross-sport commissioner tools
  | "war_room" // draft war room
  | (string & {}) // extensible for future sports

export type FeatureKey =
  | "pool_chat" // conversational assistant in a pool
  | "private_ai" // private 1:1 AI assistant
  | "commissioner_insights" // proactive commissioner value
  | "bracket_recommendation" // AI bracket pick guidance
  | "lineup_advice" // start/sit, waiver wire
  | "matchup_preview" // this-week opponent analysis
  | "draft_advice" // live draft pick recommendations
  | "trade_eval" // trade evaluator
  | "rooting_guide" // "who do you need to win?"
  | "pool_swing" // "which match shakes the leaderboard?"
  | "champion_risk" // "how crowded is your champion pick?"
  | "recap" // post-round/game summary
  | "at_risk" // entries that can't catch the leader
  | "trash_talk" // pool engagement fire-starter
  | "social_invite" // shareable join post
  | "tomorrow_hype" // upcoming matches preview
  | "hype" // general pool hype
  | "waiver_wire" // waiver wire analysis
  | "injury_report" // injury impact analysis
  | "power_rankings" // league power rankings
  | (string & {})

export type UserRole = "owner" | "commissioner" | "admin" | "member" | "guest"

/** Maps to ProviderProfile in providerRouter — "standard" is the router default. */
type AiProfile = "cheap" | "standard" | "premium" | "deterministic"

// ─────────────────────────────────────────────────────────────────────────────
// Data freshness — matches DataSourceDisclosure tier in chimmyGroundingPacket
// ─────────────────────────────────────────────────────────────────────────────

export type DataFreshnessTier =
  | "live" // active live feed with real-time scores/events
  | "cached" // recently polled provider data
  | "schedule_only" // fixture schedule exists; no live/final scores
  | "pool_only" // only pool/bracket data; no sports provider data
  | "none" // no reliable data of any kind

export type DataSourceMeta = {
  tier: DataFreshnessTier
  /** Human-readable label — Chimmy MUST cite this verbatim. */
  label: string | null
  poolDataLabel: string
  ageMinutes: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine input
// ─────────────────────────────────────────────────────────────────────────────

export type AIEngineInput = {
  sport: SportKey
  feature: FeatureKey
  userQuestion: string
  userId: string
  /** Pool ID, league ID, challenge ID — whatever identifies the context. */
  contextId: string
  /** Optional: scope insights to a specific entry/team/bracket. */
  entryId?: string
  locale?: string | null
  entitlements: {
    plan: "free" | "pro" | "commissioner" | "supreme" | "war_room" | (string & {})
    tokenBalance?: number
  }
  userRole: UserRole
  /**
   * Skip the LLM call entirely — return deterministic insights only.
   * Useful for performance-sensitive paths or pre-computation.
   */
  skipAi?: boolean
  /** "deterministic" also skips AI, same as skipAi. */
  aiProfile?: AiProfile
  /** Pass-through metadata for logging/telemetry. */
  meta?: Record<string, unknown>
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine output
// ─────────────────────────────────────────────────────────────────────────────

export type AIEngineOutput = {
  sport: SportKey
  feature: FeatureKey
  /**
   * All deterministic facts — scores, percentages, rankings, pick counts.
   * NEVER AI-generated. The structure is sport+feature specific.
   */
  insights: Record<string, unknown>
  /**
   * AI explanation / narrative / tone layer.
   * null when skipAi=true or when the AI call fails.
   * NEVER contains numbers the AI invented — only interpretation of insights.
   */
  aiResponse: string | null
  /** What data tier powered this response. */
  dataSource: DataSourceMeta
  /**
   * The full grounding packet sent to the LLM.
   * Useful for debugging, logging, and audit.
   */
  groundingPacket: Record<string, unknown>
  meta: {
    durationMs: number
    aiModel: string | null
    aiProvider: string | null
    aiCalled: boolean
    aiTokensUsed: number | null
    deterministic: boolean
    pluginVersion: string
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sport Plugin interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every sport implements this interface. Register instances in registry.ts.
 *
 * Generic params:
 *   TContext      — DB-fetched pool/league/entry data
 *   TProviderData — live/cached sports API response data
 *   TInsights     — all pre-computed deterministic results
 *
 * THE PRIME DIRECTIVE: computeInsights MUST NOT call any AI service.
 * All numbers, percentages, rankings, and comparisons live in computeInsights.
 * AI only touches buildGroundingPacket content AFTER it is fully computed.
 */
export interface SportPlugin<
  TContext = Record<string, unknown>,
  TProviderData = Record<string, unknown>,
  TInsights = Record<string, unknown>,
> {
  /** Unique identifier — must match a SportKey value. */
  readonly sport: SportKey

  /** Semantic version. Bump when the grounding packet schema changes. */
  readonly version: string

  /** Features this plugin handles (used for validation + routing). */
  readonly features: FeatureKey[]

  /**
   * Step 1 — Fetch pool/league/entry context from the database.
   * This is pure data retrieval — no calculations.
   */
  fetchContext(input: AIEngineInput): Promise<TContext>

  /**
   * Step 2 — Fetch live or cached sports data from an external provider.
   * Returns null when no provider is configured or data is unavailable.
   * Must capture fetchedAt so the engine can compute age accurately.
   */
  fetchProviderData(
    context: TContext,
    input: AIEngineInput,
  ): Promise<{ data: TProviderData; freshness: DataFreshnessTier; fetchedAt: Date } | null>

  /**
   * Step 3 — Compute ALL deterministic insights.
   *
   * Everything that requires math, scoring, ranking, percentages, comparisons,
   * or conditional logic goes here. MUST be pure and independently testable.
   * MUST NOT call any AI service, make network requests, or log user data.
   *
   * Examples of what belongs here:
   * - Leaderboard rows + ranks
   * - Pick concentration percentages
   * - Points at risk calculations
   * - Chaos ratings for upcoming matches
   * - Win probability estimates (from scoring models, not AI)
   * - Waiver priority scores
   * - Start/sit rankings
   */
  computeInsights(
    context: TContext,
    providerData: TProviderData | null,
    input: AIEngineInput,
  ): Promise<TInsights>

  /**
   * Step 4 — Build the grounding packet for the LLM.
   *
   * The packet is the ONLY source of facts the AI may use.
   * All numeric values must come from the pre-computed insights param.
   * Never pass raw DB rows — only clean, typed, serializable facts.
   */
  buildGroundingPacket(
    context: TContext,
    providerData: TProviderData | null,
    insights: TInsights,
    input: AIEngineInput,
  ): Record<string, unknown>

  /**
   * Step 5 — Build the system prompt for this sport/feature combination.
   *
   * Must include the grounding enforcement preamble:
   * "Only answer using facts in the GROUNDING PACKET."
   * The engine prepends a universal safety header; the plugin adds sport voice.
   */
  buildSystemPrompt(input: AIEngineInput): string

  /**
   * Step 6 (optional) — Sport-specific response sanitization.
   * Strip forbidden terms, check factual compliance, redact PII.
   * The engine runs a universal sanitizer first; this adds sport-specific rules.
   */
  validateResponse?(response: string, input: AIEngineInput): string
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

export type PluginRegistry = Map<SportKey, SportPlugin<unknown, unknown, unknown>>
