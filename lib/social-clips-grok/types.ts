/**
 * Grok social clip types (Prompt 116).
 */

export const SOCIAL_ASSET_TYPES = [
  'weekly_league_winners',
  'biggest_upset',
  'top_scoring_team',
  'trending_waiver_adds',
  'draft_highlights',
  'rivalry_moments',
  'bracket_challenge_highlights',
  'ai_insight_moments',
  'sport_platform_highlights',
] as const;

export type SocialAssetType = (typeof SOCIAL_ASSET_TYPES)[number];

export const SUPPORTED_PLATFORMS = ['x', 'instagram', 'tiktok', 'facebook', 'reddit'] as const;
export type SocialPlatform = (typeof SUPPORTED_PLATFORMS)[number];

export interface GrokSocialOutput {
  shortCaption: string;
  shortScriptOverlay: string;
  headline: string;
  ctaText: string;
  hashtags: string[];
  socialCardCopy: string;
  clipTitle: string;
  platformVariants?: Record<string, { caption: string; hashtags: string[] }>;
}

export interface SocialPromptBuildInput {
  sport: string;
  assetType: SocialAssetType;
  leagueName?: string;
  week?: number;
  tone?: string;
  brandingHint?: string;
}
