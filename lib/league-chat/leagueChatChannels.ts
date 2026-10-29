/**
 * League chat CHANNELS (native league handoff §6, 2026-10-18): general, trash-talk, trades, waivers.
 * Chimmy is the fifth, gold channel in the UI, but it is the existing private Chimmy thread, not a
 * stored room, so it is not listed here.
 *
 * Storage: no new table. A message's room is the server-owned `metadata.leagueChannel` key, stamped
 * by POST /api/league/chat from a validated `leagueChannel` body field — the same shape Big Brother
 * rooms already use (`metadata.bbChannel`, lib/big-brother/bbChatChannelAccess.ts). Every existing
 * row has no key and so reads as #general, which is exactly what it was. The client can never write
 * the key through `metadata` (sanitizeClientMessageMetadata drops it).
 *
 * System cards follow their topic: a trade card or trade notice also shows in #trades, a waiver
 * notice also in #waivers, and both stay in #general as they always have (Chat.png draws them there).
 */

export const LEAGUE_CHAT_CHANNEL_IDS = ['general', 'trash-talk', 'trades', 'waivers'] as const
export type LeagueChatChannelId = (typeof LEAGUE_CHAT_CHANNEL_IDS)[number]

export const LEAGUE_CHAT_CHANNELS: ReadonlyArray<{ id: LeagueChatChannelId; description: string }> = [
  { id: 'general', description: 'Everything in the league' },
  { id: 'trash-talk', description: 'Say it with your chest' },
  { id: 'trades', description: 'Offers, accepts and reviews post here' },
  { id: 'waivers', description: 'Claims and waiver results' },
]

export function isLeagueChatChannelId(value: unknown): value is LeagueChatChannelId {
  return typeof value === 'string' && (LEAGUE_CHAT_CHANNEL_IDS as readonly string[]).includes(value)
}

/** The room a request names, or null when it names none / an unknown one (callers then do not filter). */
export function parseLeagueChatChannel(value: unknown): LeagueChatChannelId | null {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return isLeagueChatChannelId(v) ? v : null
}

const TRADE_TYPES = new Set(['trade', 'trade_notice', 'trade_accepted', 'trade_card'])
const WAIVER_TYPES = new Set(['waiver_bot', 'waiver_notice', 'waiver_result', 'waiver'])

type ChannelMessage = { metadata?: unknown; messageType?: string | null }

function metadataChannel(metadata: unknown): LeagueChatChannelId | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  return parseLeagueChatChannel((metadata as Record<string, unknown>).leagueChannel)
}

/** The room a stored message was posted in. No key = #general. */
export function leagueChannelOfMessage(message: ChannelMessage): LeagueChatChannelId {
  return metadataChannel(message.metadata) ?? 'general'
}

/** Does this message belong in `channel`'s transcript? */
export function messageInLeagueChannel(message: ChannelMessage, channel: LeagueChatChannelId): boolean {
  const own = leagueChannelOfMessage(message)
  if (own === channel) return true
  const type = String(message.messageType ?? '').toLowerCase()
  // A topic system card is cross-posted to its topic room; it was never posted "in" a room.
  if (own === 'general' && channel === 'trades' && TRADE_TYPES.has(type)) return true
  if (own === 'general' && channel === 'waivers' && WAIVER_TYPES.has(type)) return true
  return false
}

/** The metadata to store for a message posted in `channel`: #general adds nothing. */
export function withLeagueChannel<T extends Record<string, unknown>>(
  metadata: T | undefined | null,
  channel: LeagueChatChannelId | null,
): T | Record<string, unknown> | undefined {
  if (!channel || channel === 'general') return metadata ?? undefined
  return { ...(metadata ?? {}), leagueChannel: channel }
}
