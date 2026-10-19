/**
 * "Post to league chat" from the tournament share card: the card's PNG, a short caption and the
 * trophy-page link, posted into the poster's OWN conference league chat.
 *
 * Reused, never re-implemented:
 *   - the card — `loadTrophy` + `buildShareCard`, exactly what the trophy page renders, so the
 *     caption can never disagree with the card;
 *   - league membership — `resolveLeagueMembership` (lib/league-access), the canonical predicate;
 *   - the image — private chat storage (`putPrivateChatFile` under the league's chat prefix, handed
 *     back as `chatUploadReadUrl`), the same path the chat composer's photo upload takes, so only
 *     league members can open it;
 *   - the post — `createLeagueChatMessage` with a deterministic row id;
 *   - what happens after a post — the Discord relay (`syncOutboundLeagueChat`) and the "new message in
 *     your league chat" alert (`queueLeagueChatNotifications`, which honours each member's League chat
 *     preference), the same two calls `POST /api/league/chat` makes after saving a user message.
 *     `createLeagueChatMessage` sends neither, so each fires exactly once here.
 *
 * ONCE PER MOMENT: the row id is derived from (tournament, entry, poster, headline). The headline is
 * the moment ("Made the bracket", "Final four", "CHAMPION"…), so a manager can post again when their
 * run reaches a new stage, never twice for the same one. The id is checked before the image is
 * stored, so a repeat costs no storage.
 *
 * No provider is called. Nothing here logs ids, captions or URLs.
 */
import 'server-only'
import { createHash, randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { syncOutboundLeagueChat } from '@/lib/discord/sync-outbound'
import { queueLeagueChatNotifications } from '@/lib/chat-notifications/chatMessageNotifier'
import { privateChatStorageConfigured, putPrivateChatFile } from '@/lib/chat-core/privateStorage'
import { chatUploadPrefix, chatUploadReadUrl } from '@/lib/chat-core/chatUploadAccess'
import { getBaseUrl } from '@/lib/get-base-url'
import { loadTrophy } from './lifecycle'
import { buildShareCard, type ShareCard } from './shareCard'

export const SHARE_IMAGE_MAX_BYTES = 5 * 1024 * 1024

export class ShareToChatError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ShareToChatError'
  }
}

export const trophyHref = (tournamentId: string, entryId: string) => `/tournament-trophy/${encodeURIComponent(tournamentId)}?entry=${encodeURIComponent(entryId)}`

/** Deterministic chat row id: one post per poster, entry and moment. */
export function shareMessageId(tournamentId: string, entryId: string, userId: string, headline: string): string {
  return 'tshare_' + createHash('sha256').update([tournamentId, entryId, userId, headline].join('\u0000')).digest('hex').slice(0, 40)
}

export function shareCaption(card: ShareCard, tournamentName: string): string {
  return `${card.team} · ${card.headline} — ${tournamentName}. ${card.subtitle}`.slice(0, 400)
}

/** The app league the user plays in for this tournament, when they are a member of it. */
export async function findShareChatLeague(tournamentId: string, userId: string): Promise<{ leagueId: string; name: string } | null> {
  const rows = await prisma.tournamentLeagueParticipant.findMany({
    where: { userId, league: { tournamentId, leagueId: { not: null } } },
    select: { league: { select: { leagueId: true, name: true } } },
    take: 5,
  })
  for (const row of rows) {
    const leagueId = row.league.leagueId
    if (!leagueId) continue
    const membership = await resolveLeagueMembership(leagueId, userId)
    if (membership.ok) return { leagueId, name: row.league.name }
  }
  return null
}

/** Whether this user would be allowed to post a card from this tournament (drives the button). */
export async function canPostShareCard(tournamentId: string, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  return Boolean(await findShareChatLeague(tournamentId, userId).catch(() => null))
}

export type ShareToChatResult = { leagueId: string; leagueName: string; messageId: string; image: boolean }

export async function postShareCardToLeagueChat(input: { userId: string; tournamentId: string; entryId: string; image: Blob | null }): Promise<ShareToChatResult> {
  const view = await loadTrophy(input.tournamentId)
  if (!view) throw new ShareToChatError('This tournament has no share card yet.', 404)
  const card = buildShareCard(view, input.entryId)
  if (!card) throw new ShareToChatError('That team is not in this tournament.', 404)
  const league = await findShareChatLeague(input.tournamentId, input.userId)
  if (!league) throw new ShareToChatError('Only managers in one of this tournament’s leagues can post to its chat.', 403)

  const messageId = shareMessageId(input.tournamentId, input.entryId, input.userId, card.headline)
  const already = await prisma.leagueChatMessage.findUnique({ where: { id: messageId }, select: { id: true } })
  if (already) throw new ShareToChatError('You already posted this card to your league chat.', 409)

  let imageUrl: string | null = null
  if (input.image) {
    if (input.image.type !== 'image/png') throw new ShareToChatError('The card image must be a PNG.', 400)
    if (input.image.size > SHARE_IMAGE_MAX_BYTES) throw new ShareToChatError('The card image is too large (max 5MB).', 400)
    if (privateChatStorageConfigured()) {
      try {
        const pathname = await putPrivateChatFile(`${chatUploadPrefix({ kind: 'league', id: league.leagueId })}/image/${randomUUID()}.png`, input.image, 'image/png')
        imageUrl = chatUploadReadUrl(pathname)
      } catch {
        // Never echo the storage error; the post still goes out with its link.
        console.warn('[tournament/divisions] share card image could not be stored')
      }
    }
  }

  const href = trophyHref(input.tournamentId, input.entryId)
  const text = `${shareCaption(card, view.tournament.name)}\n${getBaseUrl()}${href}`
  const metadata = {
    ...(imageUrl ? { attachments: [{ type: 'image', url: imageUrl, mimeType: 'image/png' }] } : {}),
    tournamentShare: { tournamentId: input.tournamentId, entryId: input.entryId, headline: card.headline, href },
  }
  const created = await createLeagueChatMessage(league.leagueId, input.userId, text, { idempotencyKey: messageId, imageUrl, metadata })
  if (!created) throw new ShareToChatError('You already posted this card to your league chat.', 409)

  // Same follow-up as a member's own message. The card image lives in private chat storage, so the
  // Discord relay carries the caption and link only.
  await syncOutboundLeagueChat({
    leagueId: league.leagueId,
    messageId: created.id,
    authorName: created.senderName ?? 'Manager',
    authorAvatarUrl: created.senderAvatarUrl ?? null,
    text: created.body,
    gifUrl: null,
  }).catch(() => console.warn('[tournament/divisions] share card Discord relay failed'))
  queueLeagueChatNotifications({
    leagueId: league.leagueId,
    messageId: created.id,
    senderUserId: input.userId,
    messageType: created.messageType ?? 'text',
    body: text,
    metadata,
    source: 'league',
  })
  return { leagueId: league.leagueId, leagueName: league.name, messageId, image: Boolean(imageUrl) }
}
