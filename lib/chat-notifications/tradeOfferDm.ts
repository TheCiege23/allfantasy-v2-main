import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  createPlatformThread,
  createPlatformThreadMessage,
  createSystemMessage,
} from '@/lib/platform/chat-service'
import {
  TRADE_OFFER_META_KEY,
  TRADE_OFFER_STATUS_META_KEY,
  buildTradeOfferMessageText,
  buildTradeStatusMessageText,
  readTradeOffer,
  type TradeOfferCard,
  type TradeOfferSource,
  type TradeOfferStatus,
} from './tradeOfferCard'
import { safeDisplayName } from './displayName'

/**
 * A trade offer, posted into the DM between the two managers so they can find it in the
 * conversation they already have — plus a one-line follow-up when it is answered.
 *
 * 🛑 IDEMPOTENT BY A CLAIM ROW, AND THE CLAIM IS THE FIRST THING EVERY CALL DOES. Offers are
 * posted from several places — the trade engine, the redraft trade center, the draft-pick trade
 * route, the Sleeper sweep, the Yahoo scan — and some of those run again and again over the same
 * offer. A `SportsDataCache` row per offer (`trade-dm:v1:<source>:<tradeId>:offer`) is created
 * with a unique key before anything is posted; a unique violation means someone already did.
 * Status follow-ups claim `…:status:<status>` the same way, so "accepted" is said once however
 * many times accept is retried.
 *
 * ⚠ THE CLAIM COMES BEFORE EVERY OTHER READ ON PURPOSE. Callers fire this and do not await it, so
 * it can still be running when the caller's next operation starts. Doing nothing but a claim
 * first keeps it from racing the caller for the same rows.
 *
 * ⚠ NEVER A DM WITH A NON-USER, AND NEVER ACROSS A BLOCK. Both managers must resolve to an
 * AllFantasy account; an imported-league offer whose other side is not on AllFantasy is skipped,
 * and so is any pair where either has blocked the other.
 *
 * ⚠ A FAILED POST RELEASES ITS CLAIM, so the next attempt can try again. A pair that is blocked
 * keeps the claim with the reason recorded: that is a decision, not a transient failure.
 */

export const TRADE_DM_KEY_PREFIX = 'trade-dm:v1:'
const TRADE_DM_TTL_MS = 180 * 24 * 60 * 60 * 1000

export type TradeDmResult =
  | { posted: true; threadId: string; messageId: string }
  | {
      posted: false
      reason:
        | 'already_posted'
        | 'no_offer_in_dm'
        | 'same_user'
        | 'unknown_user'
        | 'blocked'
        | 'thread_failed'
        | 'post_failed'
        | 'no_card'
    }

export function tradeOfferDmKey(source: TradeOfferSource, tradeId: string): string {
  return `${TRADE_DM_KEY_PREFIX}${source}:${tradeId}:offer`
}

export function tradeStatusDmKey(source: TradeOfferSource, tradeId: string, status: TradeOfferStatus): string {
  return `${TRADE_DM_KEY_PREFIX}${source}:${tradeId}:status:${status}`
}

function prismaCode(e: unknown): string | null {
  return e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : null
}

function logSafe(e: unknown): Record<string, unknown> {
  if (e && typeof e === 'object') {
    const r = e as { name?: unknown; code?: unknown }
    return { name: typeof r.name === 'string' ? r.name : 'Error', code: typeof r.code === 'string' ? r.code : undefined }
  }
  return { name: typeof e }
}

/** true = ours; false = already claimed. Throws on a store failure. */
async function claim(key: string, data: Record<string, unknown>): Promise<boolean> {
  try {
    await prisma.sportsDataCache.create({
      data: { cacheKey: key, data: data as object, expiresAt: new Date(Date.now() + TRADE_DM_TTL_MS) },
    })
    return true
  } catch (e) {
    if (prismaCode(e) === 'P2002') return false
    throw e
  }
}

async function release(key: string): Promise<void> {
  try {
    await prisma.sportsDataCache.deleteMany({ where: { cacheKey: key } })
  } catch {
    /* A claim that outlives a failure only means this offer is not retried; never worth a throw. */
  }
}

async function record(key: string, data: Record<string, unknown>): Promise<void> {
  try {
    await prisma.sportsDataCache.update({ where: { cacheKey: key }, data: { data: data as object } })
  } catch (e) {
    console.warn('[trade-dm] claim row not updated', { ...logSafe(e) })
  }
}

/**
 * The DM between two AllFantasy users, found or created through the same service `/api/shared/
 * chat/dm/start` uses (`createPlatformThread`, which returns the existing 1:1 thread when there is
 * one). Refuses the same user twice, a user id with no account, and a blocked pair.
 */
export async function findOrCreateDirectThread(
  userA: string,
  userB: string,
): Promise<{ threadId: string } | { refused: 'same_user' | 'unknown_user' | 'blocked' | 'thread_failed' }> {
  if (!userA || !userB || userA === userB) return { refused: 'same_user' }
  const users = await prisma.appUser.findMany({ where: { id: { in: [userA, userB] } }, select: { id: true } })
  if (users.length !== 2) return { refused: 'unknown_user' }
  const blocked = await prisma.platformBlockedUser.findFirst({
    where: {
      OR: [
        { blockerUserId: userA, blockedUserId: userB },
        { blockerUserId: userB, blockedUserId: userA },
      ],
    },
    select: { id: true },
  })
  if (blocked) return { refused: 'blocked' }
  const thread = await createPlatformThread({
    creatorUserId: userA,
    threadType: 'dm',
    productType: 'shared',
    memberUserIds: [userB],
  })
  return thread?.id ? { threadId: thread.id } : { refused: 'thread_failed' }
}

export type PostTradeOfferInput = {
  source: TradeOfferSource
  tradeId: string
  /**
   * Resolves both managers and the card. Runs only AFTER the claim succeeds, so a repeat call
   * costs one insert and nothing else. Return null to skip (a multi-team trade, a non-user).
   */
  load: () => Promise<{
    card: TradeOfferCard
    proposerUserId: string
    receiverUserId: string
    /**
     * Who the message is posted as. The proposer when we know who proposed; null posts it as a
     * system message (Yahoo does not say who offered).
     */
    postAsUserId: string | null
  } | null>
}

export async function postTradeOfferToDm(input: PostTradeOfferInput): Promise<TradeDmResult> {
  const key = tradeOfferDmKey(input.source, input.tradeId)
  if (!(await claim(key, { state: 'claimed', claimedAt: new Date().toISOString() }))) {
    return { posted: false, reason: 'already_posted' }
  }
  try {
    const loaded = await input.load()
    if (!loaded) {
      await release(key)
      return { posted: false, reason: 'no_card' }
    }
    const thread = await findOrCreateDirectThread(loaded.proposerUserId, loaded.receiverUserId)
    if ('refused' in thread) {
      if (thread.refused === 'blocked') await record(key, { state: 'refused', reason: 'blocked' })
      else await release(key)
      return { posted: false, reason: thread.refused }
    }
    const text = buildTradeOfferMessageText(loaded.card)
    const metadata = { [TRADE_OFFER_META_KEY]: loaded.card }
    const message = loaded.postAsUserId
      ? await createPlatformThreadMessage(loaded.postAsUserId, thread.threadId, text, 'text', metadata)
      : await createSystemMessage(thread.threadId, 'text', text, metadata)
    if (!message?.id) {
      await release(key)
      return { posted: false, reason: 'post_failed' }
    }
    await record(key, {
      state: 'posted',
      threadId: thread.threadId,
      messageId: message.id,
      postedAt: new Date().toISOString(),
    })
    return { posted: true, threadId: thread.threadId, messageId: message.id }
  } catch (e) {
    await release(key)
    throw e
  }
}

export type PostTradeStatusInput = {
  source: TradeOfferSource
  tradeId: string
  status: TradeOfferStatus
  /** Who answered, when there is a person to name. */
  actorUserId?: string | null
  /** A name to use when the actor has no AllFantasy account (a commissioner action, a provider). */
  actorName?: string | null
  detail?: string | null
}

/**
 * The follow-up line, in the same DM as the offer. Does nothing when no offer was posted there —
 * a trade proposed before this shipped, or one whose pair could not share a DM.
 *
 * Also stamps the new status onto the offer card itself, so the card stops saying "Pending".
 */
export async function postTradeStatusToDm(input: PostTradeStatusInput): Promise<TradeDmResult> {
  const offer = await prisma.sportsDataCache.findUnique({
    where: { cacheKey: tradeOfferDmKey(input.source, input.tradeId) },
    select: { data: true },
  })
  const offerData = (offer?.data ?? null) as { state?: unknown; threadId?: unknown; messageId?: unknown } | null
  const threadId = typeof offerData?.threadId === 'string' ? offerData.threadId : null
  const messageId = typeof offerData?.messageId === 'string' ? offerData.messageId : null
  if (offerData?.state !== 'posted' || !threadId) return { posted: false, reason: 'no_offer_in_dm' }

  const key = tradeStatusDmKey(input.source, input.tradeId, input.status)
  if (!(await claim(key, { state: 'claimed', claimedAt: new Date().toISOString() }))) {
    return { posted: false, reason: 'already_posted' }
  }
  try {
    const [offerMessage, actor] = await Promise.all([
      messageId
        ? prisma.platformChatMessage.findUnique({ where: { id: messageId }, select: { metadata: true } }).catch(() => null)
        : Promise.resolve(null),
      input.actorUserId
        ? prisma.appUser
            .findUnique({ where: { id: input.actorUserId }, select: { displayName: true, username: true } })
            .catch(() => null)
        : Promise.resolve(null),
    ])
    const card = readTradeOffer(offerMessage?.metadata ?? null)
    const actorName = actor
      ? safeDisplayName([actor.displayName, actor.username], input.actorName?.trim() || 'Someone')
      : (input.actorName?.trim() || null)

    const text = buildTradeStatusMessageText({
      status: input.status,
      actorName,
      proposerName: card?.proposer.manager ?? null,
      receiverName: card?.receiver.manager ?? null,
      detail: input.detail ?? null,
      answerOn: card?.answerOn ?? null,
    })
    const posted = await createSystemMessage(threadId, 'text', text, {
      [TRADE_OFFER_STATUS_META_KEY]: {
        source: input.source,
        tradeId: input.tradeId,
        status: input.status,
        href: card?.href ?? null,
      },
    })
    if (!posted?.id) {
      await release(key)
      return { posted: false, reason: 'post_failed' }
    }

    // The card is a snapshot; keep its status honest. Best-effort — the line above already said it.
    if (messageId && card && offerMessage?.metadata && typeof offerMessage.metadata === 'object') {
      const current = offerMessage.metadata as Record<string, unknown>
      const nextMeta = {
        ...current,
        [TRADE_OFFER_META_KEY]: { ...(current[TRADE_OFFER_META_KEY] as object), status: input.status },
      }
      try {
        await prisma.platformChatMessage.update({ where: { id: messageId }, data: { metadata: nextMeta as object } })
      } catch (e) {
        console.warn('[trade-dm] offer card status not updated', { tradeId: input.tradeId, ...logSafe(e) })
      }
    }
    await record(key, { state: 'posted', messageId: posted.id, postedAt: new Date().toISOString() })
    return { posted: true, threadId, messageId: posted.id }
  } catch (e) {
    await release(key)
    throw e
  }
}

/** Fire-and-forget wrapper for request paths: returns at once, never throws, never rejects. */
export function queueTradeDm(label: string, run: () => Promise<unknown>): void {
  try {
    void run().catch((e) => console.error('[trade-dm] failed', { label, ...logSafe(e) }))
  } catch (e) {
    console.error('[trade-dm] failed to start', { label, ...logSafe(e) })
  }
}

/**
 * One line for a route that answers an offer: `queueTradeStatusInDm({ source, tradeId, status,
 * actorUserId })`. Fire-and-forget; a no-op when that offer never had a DM card.
 */
export function queueTradeStatusInDm(input: PostTradeStatusInput): void {
  queueTradeDm(`status:${input.source}:${input.status}`, () => postTradeStatusToDm(input))
}
