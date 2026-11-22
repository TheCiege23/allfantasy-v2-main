/**
 * Builds Grok prompts for viral share copy (Prompt 121).
 * Sport-aware, moment-aware; captions, headlines, CTA, hashtags, platform variants.
 */

import { normalizeToSupportedSport } from '@/lib/sport-scope';
import type { AchievementShareContext } from './types';

const SHARE_TYPE_LABELS: Record<string, string> = {
  winning_matchup: 'winning a matchup',
  winning_league: 'winning a league',
  high_scoring_team: 'high scoring team',
  bracket_success: 'bracket success',
  rivalry_win: 'rivalry win',
  playoff_qualification: 'playoff qualification',
  championship_win: 'championship win',
  great_waiver_pickup: 'great waiver pickup',
  great_trade: 'great trade',
  major_upset: 'major upset',
  top_rank_legacy: 'top rank / legacy milestone',
};

export function buildShareCopySystemPrompt(
  shareType: string,
  context: AchievementShareContext,
  sport: string
): string {
  const normalizedSport = normalizeToSupportedSport(sport ?? context.sport);
  const label = SHARE_TYPE_LABELS[shareType] ?? shareType;
  const league = context.leagueName ?? 'My League';
  const team = context.teamName ?? 'My team';

  return `You are a social copywriter for fantasy sports. Generate share-ready copy for: "${label}" in ${normalizedSport} fantasy.

Context: league="${league}", team="${team}"${context.opponentName ? `, opponent="${context.opponentName}"` : ''}${context.week != null ? `, week=${context.week}` : ''}${context.score != null ? `, score=${context.score}` : ''}${context.playerName ? `, player=${context.playerName}` : ''}${context.bracketName ? `, bracket=${context.bracketName}` : ''}${context.rivalryName ? `, rivalry=${context.rivalryName}` : ''}.

Output valid JSON only with these keys:
- caption: string (1-2 sentences, celebratory, under 200 chars)
- headline: string (under 80 chars)
- cta: string (call-to-action under 50 chars)
- hashtags: array of 4-8 hashtag strings (no # in strings)
- platformVariants: object with optional "x", "instagram", "tiktok"; each value: { caption: string, hashtags: string[] } (platform-appropriate length)

Tone: energetic, celebratory, sport-aware. No placeholders.`;
}

export function buildShareCopyUserPrompt(shareType: string, context: AchievementShareContext): string {
  const label = SHARE_TYPE_LABELS[shareType] ?? shareType;
  return `Generate viral share copy for: ${label}. Return only the JSON object.`;
}
