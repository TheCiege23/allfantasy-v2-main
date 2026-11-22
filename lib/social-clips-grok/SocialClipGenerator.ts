/**
 * Orchestrates Grok-based social clip generation (Prompt 116).
 * Returns structured content for storage and preview.
 */

import { generateSocialContent } from './GrokSocialContentService';
import type { SocialPromptBuildInput, GrokSocialOutput, SocialAssetType } from './types';
import { SOCIAL_ASSET_TYPES } from './types';
import { normalizeToSupportedSport } from '@/lib/sport-scope';

interface GenerateClipInput extends SocialPromptBuildInput {
  assetType: SocialAssetType;
}

interface GeneratedClipResult {
  title: string;
  contentBody: string;
  output: GrokSocialOutput;
  sport: string;
  assetType: string;
}

export async function generateSocialClip(
  input: GenerateClipInput
): Promise<GeneratedClipResult | null> {
  const sport = normalizeToSupportedSport(input.sport);
  const assetType = SOCIAL_ASSET_TYPES.includes(input.assetType) ? input.assetType : 'weekly_league_winners';

  const promptInput: SocialPromptBuildInput = {
    sport,
    assetType,
    leagueName: input.leagueName,
    week: input.week,
    tone: input.tone,
    brandingHint: input.brandingHint,
  };

  const output = await generateSocialContent(promptInput);
  if (!output) return null;

  const title = output.clipTitle || output.headline || 'Social clip';
  const contentBody = JSON.stringify({
    shortCaption: output.shortCaption,
    shortScriptOverlay: output.shortScriptOverlay,
    headline: output.headline,
    ctaText: output.ctaText,
    hashtags: output.hashtags,
    socialCardCopy: output.socialCardCopy,
    clipTitle: output.clipTitle,
    platformVariants: output.platformVariants,
  });

  return {
    title,
    contentBody,
    output,
    sport,
    assetType,
  };
}
