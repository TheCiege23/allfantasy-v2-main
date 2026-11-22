/**
 * Resolves share preview: URL, title, caption, copy payload (Prompt 121).
 */

import { getAchievementShareUrl, getCopyLinkPayload, getTwitterShareUrl, getFacebookShareUrl } from './SocialShareService';
import type { AchievementShareType, AchievementShareContext } from './types';
import type { GrokShareCopyOutput } from './GrokShareCopyService';

interface SharePreviewPayload {
  shareUrl: string;
  title: string;
  caption: string;
  headline: string;
  cta: string;
  hashtags: string[];
  copyLinkPayload: string;
  twitterUrl: string;
  facebookUrl: string;
  platformVariants?: Record<string, { caption: string; hashtags: string[] }>;
}

export function resolveSharePreview(
  shareType: AchievementShareType,
  context: AchievementShareContext,
  grokCopy: GrokShareCopyOutput | null,
  shareId?: string,
  origin?: string
): SharePreviewPayload {
  const shareUrl = shareId
    ? `${origin ?? (typeof window !== 'undefined' ? window.location.origin : '')}/share/${shareId}`
    : getAchievementShareUrl(shareType, context, origin);
  const title = grokCopy?.headline ?? `Share: ${shareType}`;
  const caption = grokCopy?.caption ?? '';
  const copyLinkPayload = getCopyLinkPayload(shareUrl, title);
  const textForTwitter = caption || title;
  return {
    shareUrl,
    title,
    caption,
    headline: grokCopy?.headline ?? title,
    cta: grokCopy?.cta ?? 'Join AllFantasy',
    hashtags: grokCopy?.hashtags ?? [],
    copyLinkPayload,
    twitterUrl: getTwitterShareUrl(shareUrl, textForTwitter),
    facebookUrl: getFacebookShareUrl(shareUrl),
    platformVariants: grokCopy?.platformVariants,
  };
}
