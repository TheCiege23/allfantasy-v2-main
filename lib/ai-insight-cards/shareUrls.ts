/**
 * Share URLs and copyable captions for AI Insight Cards (PROMPT 293).
 * X, Reddit: intent URLs with pre-filled text. Instagram/Discord: copy caption + download image.
 */

import { getPublicSiteOrigin } from '@/lib/site-public-origin'

export type AICardShareChannel = 'x' | 'twitter' | 'reddit' | 'instagram' | 'discord'

interface AICardShareOptions {
  /** Card title (e.g. "Trade Grade") */
  title: string
  /** AI insight or verdict (short) */
  insight: string
  /** Optional link to share (e.g. app URL) */
  url?: string
  /** Optional hashtags for X/Instagram */
  hashtags?: string[]
}

const DEFAULT_HASHTAGS = ['AllFantasy', 'FantasyFootball', 'AI']

export function buildAICardShareUrl(
  channel: AICardShareChannel,
  options: AICardShareOptions
): string {
  const { title, insight, url = getPublicSiteOrigin(), hashtags = DEFAULT_HASHTAGS } = options
  const tagStr = hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')
  const text = `${title}\n\n${insight}\n\n${tagStr}`
  const encodedText = encodeURIComponent(url ? `${text}\n\n${url}` : text)
  const encodedUrl = encodeURIComponent(url)

  switch (channel) {
    case 'x':
    case 'twitter':
      return `https://twitter.com/intent/tweet?text=${encodedText}`
    case 'reddit':
      return `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodeURIComponent(title)}`
    case 'instagram':
    case 'discord':
      return ''
  }
}

/** Copyable caption per platform (user downloads image then pastes this). */
export function getAICardCaption(
  channel: AICardShareChannel,
  options: AICardShareOptions
): string {
  const { title, insight, url = getPublicSiteOrigin(), hashtags = DEFAULT_HASHTAGS } = options
  const tagStr = hashtags.join(' ')

  switch (channel) {
    case 'x':
    case 'twitter':
      return [title, insight, tagStr, url].filter(Boolean).join('\n\n')
    case 'instagram':
      return [title, insight, tagStr].filter(Boolean).join('\n\n')
    case 'discord':
      return [title, insight].filter(Boolean).join('\n\n')
    case 'reddit':
      return `${title}\n\n${insight}`
    default:
      return `${title}\n\n${insight}`
  }
}
