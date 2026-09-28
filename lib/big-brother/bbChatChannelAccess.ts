/**
 * Big Brother private rooms — THE one read/write rule for `metadata.bbChannel`.
 *
 * A Big Brother league's chat is one table; the HOH room, the nominees' room, the Have-Nots and the
 * jury house are rows tagged `metadata.bbChannel`. Who may read or post in each is decided live by
 * `getAccessibleBbChannels` (BigBrotherChatChannels.ts). A row with no tag, or a tag that is not a
 * room, belongs to the main house.
 *
 * 🛑 ONLY `/api/league/chat` APPLIED THIS (found 2026-09-25). The shared-thread routes
 * (`/api/shared/chat/threads/league:<id>/messages` and `/search`) and the redraft communication
 * feed read the same table with no room filter, so any league member could read the HOH room and
 * the jury house; and their POSTs stored whatever `bbChannel` the client sent, so anyone could post
 * into a room they were never in. Every one of them now calls here — this file is the rule, and a
 * second copy of it in a route is how the first leak happened.
 */

import { isBigBrotherLeague } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { getAccessibleBbChannels, type BigBrotherChannelKey } from '@/lib/big-brother/BigBrotherChatChannels'

const BB_CHANNEL_KEYS: ReadonlySet<string> = new Set<BigBrotherChannelKey>([
  'main',
  'hoh_room',
  'have_nots',
  'jury',
  'nominees',
])

export function isBbChannelKey(value: unknown): value is BigBrotherChannelKey {
  return typeof value === 'string' && BB_CHANNEL_KEYS.has(value)
}

/** The room a message's metadata names, or null when it names none (or names something that is not a room). */
export function readBbChannelKeyFromMetadata(metadata: unknown): BigBrotherChannelKey | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const raw = (metadata as Record<string, unknown>).bbChannel
  return isBbChannelKey(raw) ? raw : null
}

/** The room a stored message is in: its tag, else the main house. */
export function bbChannelOfMessage(message: { metadata?: unknown }): BigBrotherChannelKey {
  return readBbChannelKeyFromMetadata(message.metadata) ?? 'main'
}

export type BbChatAccess = {
  readable: ReadonlySet<BigBrotherChannelKey>
  writable: ReadonlySet<BigBrotherChannelKey>
}

/** Null when the league is not a Big Brother league — every message is then readable, and no room applies. */
export async function getBbChatAccess(leagueId: string, userId: string): Promise<BbChatAccess | null> {
  if (!(await isBigBrotherLeague(leagueId))) return null
  const access = await getAccessibleBbChannels(leagueId, userId)
  return {
    readable: new Set(access.filter((c) => c.canRead).map((c) => c.key)),
    writable: new Set(access.filter((c) => c.canWrite).map((c) => c.key)),
  }
}

/** Keep only messages in rooms this user may read. A non-Big-Brother league is returned as it came. */
export async function filterBbReadableMessages<T extends { metadata?: unknown }>(
  leagueId: string,
  userId: string,
  messages: T[],
): Promise<T[]> {
  const access = await getBbChatAccess(leagueId, userId)
  if (!access) return messages
  return messages.filter((message) => access.readable.has(bbChannelOfMessage(message)))
}

export type BbWriteDecision =
  /** `channel` is null outside a Big Brother league: there is no room to record. */
  | { ok: true; channel: BigBrotherChannelKey | null }
  | { ok: false }

/**
 * May this user post where the client asked? The room comes from the client's `bbChannel` (the main
 * house when it names none); the answer comes from live game state, never from the client.
 */
export async function resolveBbWriteChannel(
  leagueId: string,
  userId: string,
  rawMetadata: unknown,
): Promise<BbWriteDecision> {
  const access = await getBbChatAccess(leagueId, userId)
  if (!access) return { ok: true, channel: null }
  const channel = readBbChannelKeyFromMetadata(rawMetadata) ?? 'main'
  return access.writable.has(channel) ? { ok: true, channel } : { ok: false }
}
