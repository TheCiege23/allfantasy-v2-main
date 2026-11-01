/**
 * Clubhouse — the public community board. Everything a page needs to know about the
 * fixed channel list lives here, and nothing here touches the database, so client and
 * server components import it alike.
 *
 * ⚠ `slug` IS STORED ON EVERY POST (`CommunityPost.channel`). Renaming a label is free;
 * renaming a slug orphans every post already written under the old one. Add channels,
 * reword them, reorder them — but treat a slug as permanent.
 */

/** The board's name, in one place so a rename is one edit. */
export const CLUBHOUSE_NAME = 'Clubhouse'

export type CommunityChannel = {
  slug: string
  label: string
  emoji: string
  /** One line under the channel name. */
  blurb: string
  /** Pre-filled into an empty composer, so a first post never starts from a blank box. */
  starter?: { title: string; body: string }
  /** Sport tags are offered on posts in this channel. */
  sportTags?: boolean
  /** Threads here are written by the Clubhouse itself; members reply but cannot start one. */
  systemOnly?: boolean
}

export const COMMUNITY_CHANNELS: readonly CommunityChannel[] = [
  {
    slug: 'introductions',
    label: 'Introduce Yourself',
    emoji: '👋',
    blurb: 'New here? Tell everyone what you play and what your league is like.',
    starter: {
      title: 'Hey from ',
      body:
        'What I play:\n' +
        'How long I have been commissioner (or not!):\n' +
        "My league's weirdest rule:\n" +
        'What I want to get out of the Clubhouse:',
    },
  },
  {
    slug: 'commish-corner',
    label: 'Commish Corner',
    emoji: '🏆',
    blurb: 'Running a league: settings, disputes, keeping your league active all season.',
    sportTags: true,
  },
  {
    slug: 'league-lab',
    label: 'League Lab',
    emoji: '🧪',
    blurb: 'League formats and wild ideas. Pitch one, poke holes in one, steal one.',
    sportTags: true,
  },
  {
    slug: 'sports-news',
    label: 'Sports & News',
    emoji: '📰',
    blurb: 'Injuries, breakouts, trades, hot takes. Tag the sport so people can find it.',
    sportTags: true,
  },
  {
    slug: 'game-day',
    label: 'Game Day',
    emoji: '🏟️',
    blurb: "Live chat while the games are on. Today's room opens with the day's slate.",
    systemOnly: true,
  },
  {
    slug: 'other-apps',
    label: 'Other Apps',
    emoji: '📱',
    blurb: 'Sleeper, ESPN, Yahoo, anything. What works there, what does not, what we should steal.',
  },
  {
    slug: 'ask-the-founder',
    label: 'Ask the Founder',
    emoji: '💬',
    blurb: 'Questions, feature requests and complaints, straight to the person building AllFantasy.',
  },
] as const

export const SPORT_TAGS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'] as const
export type SportTag = (typeof SPORT_TAGS)[number]

/**
 * The reaction set. Deliberately small: a fixed handful is a vocabulary people learn,
 * an open emoji picker is noise. The stored value is the emoji itself.
 */
export const COMMUNITY_REACTIONS = ['👍', '🔥', '😂', '🧠'] as const
export type CommunityReactionEmoji = (typeof COMMUNITY_REACTIONS)[number]

export function getChannel(slug: string | null | undefined): CommunityChannel | null {
  if (!slug) return null
  return COMMUNITY_CHANNELS.find((c) => c.slug === slug) ?? null
}

export function isChannelSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && getChannel(slug) !== null
}

export function clubhousePostHref(postId: string, replyId?: string): string {
  return `/clubhouse/post/${encodeURIComponent(postId)}${replyId ? `#reply-${replyId}` : ''}`
}

export function clubhouseChannelHref(slug: string): string {
  return `/clubhouse/${encodeURIComponent(slug)}`
}

export function clubhouseMemberHref(username: string): string {
  return `/clubhouse/u/${encodeURIComponent(username)}`
}

export const GAME_DAY_CHANNEL = 'game-day'
