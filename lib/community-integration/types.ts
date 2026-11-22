/**
 * Discord and Reddit Integration (PROMPT 298) — types for community share and webhooks.
 */

type CommunityContentKind =
  | 'draft_results'
  | 'weekly_recap'
  | 'trade_reaction'
  | 'power_rankings'
  | 'matchup'
  | 'league_story'
  | 'generic'

/** Content to share to Discord (copy-paste or webhook). */
export interface DiscordShareContent {
  /** Plain text to paste in channel (message + link) */
  copyText: string
  /** For webhook: optional embed payload */
  embed?: DiscordEmbedPayload
}

/** Discord webhook embed (subset of Discord API). */
export interface DiscordEmbedPayload {
  title?: string
  description?: string
  url?: string
  color?: number
  timestamp?: string
  footer?: { text: string }
  image?: { url: string }
}

/** Full payload to POST to Discord webhook. */
export interface DiscordWebhookPayload {
  content?: string
  username?: string
  avatar_url?: string
  embeds?: DiscordEmbedPayload[]
}

/** Reddit-ready post (title + body for submit or copy). */
export interface RedditReadyPost {
  /** Post title (Reddit limit 300 chars) */
  title: string
  /** Post body in Markdown (Reddit limit 40k for body) */
  body: string
  /** Suggested subreddit(s) */
  suggestedSubreddits: string[]
  /** Submit URL with url + title pre-filled (user still chooses subreddit) */
  submitUrl?: string
}

/** Input to build Discord/Reddit content. */
export interface CommunityShareInput {
  kind: CommunityContentKind
  title: string
  description: string
  url?: string
  imageUrl?: string
  /** Extra lines for body (e.g. key stats) */
  extraLines?: string[]
}
