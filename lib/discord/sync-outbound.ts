import { prisma } from '@/lib/prisma'
import { postLeagueChatEmbed, isBotConfigured } from '@/lib/discord/bot'
import { channelLink } from '@/lib/discord/deepLinks'

export type OutboundSyncInput = {
  leagueId: string
  messageId: string
  authorName: string
  authorAvatarUrl: string | null
  text: string
  gifUrl?: string | null
}

/**
 * Only the league's MAIN chat is ever copied to Discord. `source` null (or the
 * literal 'league') is main league chat; anything else is a narrower room that
 * happens to live in the same table — 'draft' for draft-only chat, and Survivor
 * tribe chats, whose whole point is that the rest of the league cannot read them.
 */
function isMainLeagueChat(source: string | null): boolean {
  return source === null || source === '' || source === 'league'
}

/**
 * Rooms that live INSIDE main league chat rows, marked only in metadata. Big Brother
 * stores its HOH room, have-nots, jury and nominees rooms as ordinary league chat
 * with `metadata.bbChannel` — so a `source` check alone would copy the HOH room's
 * private conversation into the league's Discord. Anything but the main room stays.
 */
function isPrivateRoomMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false
  const m = metadata as Record<string, unknown>
  if (m.private === true || m.isPrivate === true) return true
  if (typeof m.bbChannel === 'string' && m.bbChannel !== 'main') return true
  return false
}

/**
 * Copy one league chat line into the league's Discord channel, when the
 * commissioner has turned copying on.
 *
 * 🛑 THE MESSAGE ROW DECIDES WHETHER IT MAY LEAVE, NOT THE CALLER. Every caller
 * passes a message id, and the row is read before anything is posted: it must
 * exist, belong to this league, be public (`isPrivate` false, no
 * `visibleToUserId` — that is a Chimmy thread or a secret ballot), be main league
 * chat and not a private room inside it (Big Brother's HOH room and friends), and
 * not have come FROM Discord (a loop). A caller that forgets any of that
 * cannot leak a private line, because the check lives here and not in each caller.
 *
 * Returns `{ synced: false }` for every "not configured / not allowed" case and
 * throws only when Discord itself refused the post — after one bounded retry
 * (see `postMessage`). Callers treat Discord as best-effort: the message is
 * already safe in AllFantasy.
 */
export async function syncOutboundLeagueChat(input: OutboundSyncInput): Promise<{ synced: boolean; discordMessageId?: string }> {
  if (!isBotConfigured()) {
    return { synced: false }
  }

  const row = await prisma.discordLeagueChannel.findFirst({
    where: {
      leagueId: input.leagueId,
      surface: 'league_chat',
      syncEnabled: true,
      syncOutbound: true,
    },
    include: {
      league: { select: { name: true } },
    },
  })

  if (!row) {
    return { synced: false }
  }

  const msg = await prisma.leagueChatMessage.findUnique({
    where: { id: input.messageId },
    select: {
      leagueId: true,
      sourceDiscord: true,
      isPrivate: true,
      visibleToUserId: true,
      source: true,
      metadata: true,
    },
  })
  if (
    !msg ||
    msg.leagueId !== input.leagueId ||
    msg.sourceDiscord ||
    msg.isPrivate ||
    msg.visibleToUserId ||
    !isMainLeagueChat(msg.source) ||
    isPrivateRoomMetadata(msg.metadata)
  ) {
    return { synced: false }
  }

  const leagueName = row.league.name ?? 'League'

  const discordMessageId = await postLeagueChatEmbed(row.channelId, {
    authorName: input.authorName,
    authorAvatar: input.authorAvatarUrl ?? undefined,
    text: input.text,
    gifUrl: input.gifUrl ?? undefined,
    leagueName,
    leagueId: input.leagueId,
  })

  await prisma.discordMessageLink.create({
    data: {
      leagueMessageId: input.messageId,
      discordMessageId,
      direction: 'to_discord',
      guildId: row.guildId,
      channelId: row.channelId,
    },
  })

  return { synced: true, discordMessageId }
}

/** Fire-and-forget friendly URL for logs / admin (not stored on message by default). */
export function discordChannelUrl(guildId: string, channelId: string): string {
  return channelLink(guildId, channelId)
}
