/**
 * AllFantasy Standard AI Payload — single structured contract for every AI tool.
 * All league/roster/time values must come from resolvers/DB; never fabricate.
 */

import type { AiTimeContextPayload, DataFreshnessTimestamps } from '@/lib/time-engine/types'
import type { NormalizedLeagueContext } from '@/lib/league-context-engine/types'
import type { IntelligencePlatformHealth } from '@/lib/intelligence/types'
import type { AllFantasyLearningLayersPayload } from '@/lib/ai-learning-system/types'
import type { StrategicCoachingSnapshot } from '@/lib/long-term-coaching/types'

export type AiPayloadMode = 'global' | 'league'

/** Tool identity + routing — no invented IDs. */
export type AllFantasyAiContextBlock = {
  userId: string
  sport: string
  tool: string
  mode: AiPayloadMode
}

/**
 * Time context is the existing `AiTimeContextPayload` (server UTC, user TZ, locks, waiver, freshness).
 * @see buildAiTimeContextPayload
 */
export type AllFantasyAiTimeContextBlock = AiTimeContextPayload

/** Full normalized league rules (scoring, roster, waiver, trade, playoff). */
export type AllFantasyAiLeagueContextBlock = NormalizedLeagueContext | null

export type AiRosterPlayerRef = {
  playerId: string
  name: string | null
  position: string | null
  team: string | null
  injuryStatus: string | null
}

export type AiTeamContextPayload = {
  schemaVersion: 1
  teamId: string | null
  teamName: string | null
  platformUserId: string | null
  record: { wins: number; losses: number; ties: number } | null
  standingRank: number | null
  pointsFor: number | null
  rosterPlayerCount: number
  starters: AiRosterPlayerRef[]
  bench: AiRosterPlayerRef[]
  injuredReserve: AiRosterPlayerRef[]
  taxi: AiRosterPlayerRef[]
  opponentThisPeriod: { label: string | null; week: number | null } | null
  dataGaps: string[]
}

/** Aggregated freshness for prompts (subset also lives on timeContext). */
export type AllFantasyAiDataFreshnessBlock = {
  timestamps: DataFreshnessTimestamps
  leagueLastSyncedAt: string | null
  importMappingOk: boolean | null
  computedAt: string
}

/** Hints for orchestration layers (optional; does not change deterministic data). */
export type AiProviderRoutingHints = {
  openai?: string
  deepseek?: string
  grok?: string
}

/**
 * Canonical v2 payload — use for OpenAI / DeepSeek / Grok prompts and Chimmy bridges.
 */
export type AllFantasyStandardAiPayload = {
  schemaVersion: 2
  context: AllFantasyAiContextBlock
  timeContext: AllFantasyAiTimeContextBlock
  leagueContext: AllFantasyAiLeagueContextBlock
  teamContext: AiTeamContextPayload | null
  dataFreshness: AllFantasyAiDataFreshnessBlock
  /** Tool-specific arguments (lineup questions, trade assets, trend window, etc.). */
  toolInput: Record<string, unknown>
  /** Same as toolInput — stable alias for older prompt templates. */
  data: Record<string, unknown>
  providerHints?: AiProviderRoutingHints | null
  /** Optional platform health snapshot (same as legacy envelope `health`). */
  platformHealth?: IntelligencePlatformHealth | null
  /**
   * Deterministic 3-level learning (app / league / user) from `af_learning_*` tables.
   * Soft personalization only — never overrides injuries, locks, or scoring rules.
   */
  learningLayers?: AllFantasyLearningLayersPayload | null
  /**
   * Optional long-term strategic coaching snapshot (dynasty / devy / C2C / keeper).
   * Populated when `includeStrategicCoaching` is set on the payload builder — reflects the user’s team, not a trade partner.
   */
  strategicCoaching?: StrategicCoachingSnapshot | null
}

