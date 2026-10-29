/**
 * Survivor chat bridge — every engine post lands where players actually read.
 *
 * Survivor engines (tribe provisioning, sit-outs, merge, Torch Ceremony, Exile, finale, …) write
 * `SurvivorChatMessage` rows into `SurvivorChatChannel`s. No shipped UI reads that table: the chat
 * players open is `LeagueChatMessage`, where a tribe huddle is `source = tribe_<tribeId>` and the
 * league channel is `source = null` (see `components/chat/LeagueChatPanel.tsx` and the shared thread
 * route). Until this bridge existed, Chimmy's huddle cards, merge welcome and ceremony lines were
 * written into a table nobody could see.
 *
 * Use `createSurvivorChatMessage` / `upsertSurvivorChatMessage` instead of the bare Prisma delegate.
 * Both keep the engine row (audit, membership, archive) and mirror it into league chat:
 *
 *   channelType  league → source null            (every league member)
 *   channelType  tribe  → source tribe_<tribeId> (own tribe, or a non-playing host)
 *   channelType  merge  → source tribe_<mergedId> (every active manager after the merge)
 *   exile / jury / alliance / dm / private_ai     → engine row only (no league-chat surface yet)
 *
 * The mirror is idempotent (`survivor-chat:<engine row id>`), so a retried transaction or a
 * deterministic engine id never posts twice. A host/system row is Chimmy's: `LeagueChatMessage.userId`
 * is a required foreign key to `AppUser`, so the league owner is the technical author and the
 * server-owned `metadata.chimmy` marker gives it Chimmy's identity on read (see
 * `lib/league-chat/chimmyIdentity.ts`). A human sender keeps their own id.
 */

import type { Prisma, PrismaClient } from '@prisma/client'

import { toPrismaNullableJsonInput } from '@/lib/prisma-json'

import { tribeChatSource } from './constants'

export type SurvivorChatDb = Prisma.TransactionClient | PrismaClient

/**
 * The engine row. `cardData` is left loose on purpose: the call sites build card payloads as plain
 * records, and this bridge forwards them to Prisma exactly as the bare delegate did.
 */
export type SurvivorChatMessageData = Omit<Prisma.SurvivorChatMessageUncheckedCreateInput, 'cardData'> & { cardData?: unknown }

export type SurvivorChatMirrorOutcome =
  | { mirrored: true; leagueChatMessageId: string; source: string | null }
  | { mirrored: false; reason: 'unsupported_channel' | 'no_tribe' | 'no_league' | 'duplicate' | 'author_missing' }

const HOST_SENDER_IDS = new Set(['system', 'survivor-host-chimmy', 'survivor-ai-host'])

export const SURVIVOR_CHAT_MIRROR_PREFIX = 'survivor-chat:'

export function survivorChatMirrorId(engineMessageId: string): string {
  return `${SURVIVOR_CHAT_MIRROR_PREFIX}${engineMessageId}`
}

export function isSurvivorHostSender(data: Pick<SurvivorChatMessageData, 'senderUserId' | 'senderIsHost' | 'isSystemMessage'>): boolean {
  if (data.senderIsHost === true || data.isSystemMessage === true) return true
  const sender = String(data.senderUserId ?? '')
  return HOST_SENDER_IDS.has(sender) || sender.startsWith('survivor-')
}

/**
 * The league-chat `source` an engine channel maps to. `null` is the league channel; a string is a
 * tribe/merge huddle; `undefined` means the channel has no league-chat surface.
 */
export function survivorChannelToLeagueChatSource(
  channelType: string,
  tribeId: string | null | undefined,
): string | null | undefined {
  if (channelType === 'league') return null
  if (channelType === 'tribe' || channelType === 'merge') return tribeId ? tribeChatSource(tribeId) : undefined
  return undefined
}

function prismaCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : null
}

/**
 * Mirror one engine row into league chat. Never throws for an expected miss (unsupported channel,
 * duplicate, missing author): a Chimmy line must not roll back a council or an elimination.
 */
export async function mirrorSurvivorChatMessageToLeagueChat(
  db: SurvivorChatDb,
  row: SurvivorChatMessageData & { id: string },
): Promise<SurvivorChatMirrorOutcome> {
  const channelType = String(row.channelType)
  let tribeId: string | null = null
  if (channelType === 'tribe' || channelType === 'merge') {
    const channel = await db.survivorChatChannel.findUnique({ where: { id: row.channelId }, select: { tribeId: true } })
    tribeId = channel?.tribeId ?? null
    if (!tribeId) return { mirrored: false, reason: 'no_tribe' }
  }
  const source = survivorChannelToLeagueChatSource(channelType, tribeId)
  if (source === undefined) return { mirrored: false, reason: 'unsupported_channel' }

  const host = isSurvivorHostSender(row)
  let userId = String(row.senderUserId ?? '')
  if (host) {
    const league = await db.league.findUnique({ where: { id: row.leagueId }, select: { userId: true } })
    if (!league?.userId) return { mirrored: false, reason: 'no_league' }
    userId = league.userId
  }

  const cardData = row.cardData && typeof row.cardData === 'object' ? (row.cardData as Record<string, unknown>) : null
  const metadata: Record<string, unknown> = {
    ...(host ? { chimmy: true } : {}),
    survivorChat: {
      messageId: row.id,
      channelId: row.channelId,
      channelType,
      contentType: row.contentType ?? 'text',
      ...(cardData ? { cardData } : {}),
      ...(row.isPinned ? { pinned: true } : {}),
    },
  }

  const id = survivorChatMirrorId(row.id)
  try {
    await db.leagueChatMessage.create({
      data: {
        id,
        leagueId: row.leagueId,
        userId,
        message: row.content,
        type: host ? 'system' : 'text',
        source,
        metadata: toPrismaNullableJsonInput(metadata),
        isPrivate: false,
      },
      select: { id: true },
    })
  } catch (error) {
    const code = prismaCode(error)
    if (code === 'P2002') return { mirrored: false, reason: 'duplicate' }
    if (code === 'P2003') return { mirrored: false, reason: 'author_missing' }
    throw error
  }
  return { mirrored: true, leagueChatMessageId: id, source }
}

/** The `select` / `include` shape a call site passed, so the returned row is typed like Prisma's. */
type SurvivorChatMessageShape = {
  select?: Prisma.SurvivorChatMessageSelect | null
  include?: Prisma.SurvivorChatMessageInclude | null
}
type SurvivorChatMessageResult<TArgs extends SurvivorChatMessageShape> = Prisma.SurvivorChatMessageGetPayload<{
  select: TArgs['select']
  include: TArgs['include']
}>

/** `db.survivorChatMessage.create(args)` plus the league-chat mirror. */
export async function createSurvivorChatMessage<TArgs extends SurvivorChatMessageShape & { data: SurvivorChatMessageData }>(
  db: SurvivorChatDb,
  args: TArgs,
): Promise<SurvivorChatMessageResult<TArgs>> {
  const created = (await db.survivorChatMessage.create(args as never)) as SurvivorChatMessageResult<TArgs> & { id?: string }
  const id = typeof created?.id === 'string' ? created.id : typeof args.data.id === 'string' ? args.data.id : null
  if (id) await mirrorSurvivorChatMessageToLeagueChat(db, { ...args.data, id })
  return created
}

/**
 * `db.survivorChatMessage.upsert(args)` plus the league-chat mirror. The mirror id is derived from
 * the engine row id, so an upsert that found its row mirrors nothing new.
 */
export async function upsertSurvivorChatMessage<TArgs extends SurvivorChatMessageShape & { where: { id: string }; create: SurvivorChatMessageData; update: unknown }>(
  db: SurvivorChatDb,
  args: TArgs,
): Promise<SurvivorChatMessageResult<TArgs>> {
  const row = (await db.survivorChatMessage.upsert(args as never)) as SurvivorChatMessageResult<TArgs>
  await mirrorSurvivorChatMessageToLeagueChat(db, { ...args.create, id: args.where.id })
  return row
}
