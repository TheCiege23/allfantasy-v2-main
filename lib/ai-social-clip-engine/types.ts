/**
 * AllFantasy AI Social Clip Engine — types (PROMPT 146).
 * Input types, output types, provider roles, deterministic facts.
 */

import type { LeagueSport } from "@prisma/client";

/** Supported input types for clip generation. */
export const CLIP_INPUT_TYPES = [
  "matchup_result",
  "trade_verdict",
  "power_rankings",
  "player_trend_alert",
  "story_recap",
  "creator_league_promo",
  "bracket_update",
] as const;

export type ClipInputType = (typeof CLIP_INPUT_TYPES)[number];

/** Output format / use-case. */
export const CLIP_OUTPUT_TYPES = [
  "short_post",
  "thread_format",
  "image_caption",
  "video_caption",
  "promo_copy",
  "recap_copy",
] as const;

export type ClipOutputType = (typeof CLIP_OUTPUT_TYPES)[number];

/** Provider roles per PROMPT 146. */
export type ProviderRole = "xai" | "openai" | "deepseek";

/** Deterministic facts injected for DeepSeek consistency check and copy accuracy. */
export interface DeterministicFacts {
  sport?: string;
  leagueName?: string;
  week?: number;
  round?: string;
  /** e.g. "Team A 142, Team B 118" */
  matchupSummary?: string;
  /** e.g. "Fair trade: 85/100" */
  tradeVerdictSummary?: string;
  /** Top N names or ranks */
  rankingsSummary?: string;
  /** Player name, trend, alert text */
  trendAlertSummary?: string;
  /** Recap headline or key points */
  storySummary?: string;
  /** Creator / league promo context */
  promoContext?: string;
  /** Bracket round, winner, etc. */
  bracketSummary?: string;
  [key: string]: unknown;
}

export interface AIClipGenerateInput {
  inputType: ClipInputType;
  outputType: ClipOutputType;
  sport?: LeagueSport | string;
  leagueName?: string;
  /** Injected into prompts; used for fact check and final copy. */
  deterministicFacts?: DeterministicFacts;
  tone?: string;
  brandingHint?: string;
}

/** Single provider result (narrative, fact-check, or polished copy). */
export interface ProviderStepResult {
  provider: ProviderRole;
  success: boolean;
  text?: string;
  json?: Record<string, unknown>;
  error?: string;
}

/** Final structured output stored in SocialContentAsset. */
export interface AIClipResult {
  shortCaption: string;
  headline: string;
  ctaText: string;
  hashtags: string[];
  socialCardCopy: string;
  clipTitle: string;
  platformVariants?: Record<string, { caption: string; hashtags: string[] }>;
  /** Optional thread as array of tweet-length strings */
  thread?: string[];
  /** Which providers were used (for audit). */
  providersUsed: ProviderRole[];
  /** Fact-check passed (DeepSeek). */
  factCheckPassed?: boolean;
}

