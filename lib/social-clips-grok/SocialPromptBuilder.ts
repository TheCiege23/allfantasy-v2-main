/**
 * Builds Grok prompts for social clip content (Prompt 116).
 * Sport-aware, event-aware, platform-appropriate short-form copy.
 */

import { normalizeToSupportedSport } from '@/lib/sport-scope';
import type { SocialAssetType, SocialPromptBuildInput } from './types';
import { SOCIAL_ASSET_TYPES } from './types';

const ASSET_LABELS: Record<SocialAssetType, string> = {
  weekly_league_winners: 'weekly league winners',
  biggest_upset: 'biggest upset',
  top_scoring_team: 'top scoring team',
  trending_waiver_adds: 'trending waiver adds',
  draft_highlights: 'draft highlights',
  rivalry_moments: 'rivalry moments',
  bracket_challenge_highlights: 'bracket challenge highlights',
  ai_insight_moments: 'Chimmy insight moments',
  sport_platform_highlights: 'sport-specific platform highlights',
};

export function buildSocialSystemPrompt(input: SocialPromptBuildInput): string {
  const sport = normalizeToSupportedSport(input.sport);
  const assetType = SOCIAL_ASSET_TYPES.includes(input.assetType as SocialAssetType)
    ? input.assetType
    : 'weekly_league_winners';
  const label = ASSET_LABELS[assetType as SocialAssetType];
  const league = input.leagueName ?? 'your league';
  const week = input.week ?? 1;
  const tone = input.tone ?? 'energetic and fun';
  const branding = input.brandingHint ?? 'AllFantasy — fantasy sports insights';

  return `You are a social media copywriter for fantasy sports. Generate short-form social content for ${sport} fantasy: "${label}".

Context:
- Sport: ${sport}
- League/event: ${league}${input.week != null ? `, Week ${week}` : ''}
- Tone: ${tone}
- Branding: ${branding}

Output valid JSON only, with these exact keys:
- shortCaption: string (1-2 sentences, under 200 chars, for feed post)
- shortScriptOverlay: string (under 90 chars, punchy overlay line for short clips)
- headline: string (under 80 chars)
- ctaText: string (under 50 chars, call-to-action)
- hashtags: array of 3-6 hashtag strings
- socialCardCopy: string (under 150 chars for card overlay)
- clipTitle: string (under 60 chars for video/clip title)
- platformVariants: object with optional keys "x", "instagram", "tiktok", "facebook"; each value: { caption: string, hashtags: string[] } (platform-appropriate length)

Keep copy punchy, sport-aware, and event-aware. No placeholder text.`;
}

export function buildSocialUserPrompt(input: SocialPromptBuildInput): string {
  const assetType = SOCIAL_ASSET_TYPES.includes(input.assetType as SocialAssetType)
    ? input.assetType
    : 'weekly_league_winners';
  const label = ASSET_LABELS[assetType as SocialAssetType];
  return `Generate social copy for: ${label}. Sport: ${input.sport}. Return only the JSON object.`;
}
