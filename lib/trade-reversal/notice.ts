/**
 * Telling the league a trade was reversed.
 *
 * Both reversal engines write a `noticeKey` onto their `TradeReversal` row (`af_trade:<id>:reversed`,
 * `redraft_trade:<id>:reversed`) and, until this module, nothing dispatched it. A commissioner could undo
 * two managers' trade and the league would find out only by noticing their rosters had changed.
 *
 * ⚠ THE SAME PATH EVERY OTHER LEAGUE TRADE NOTICE USES. `publishLeagueFanoutEvent` → `dispatchNotification`
 * is the single sanctioned fan-out. The `notification_outbox` table is deliberately NOT used: it has no
 * email/SMS consumer, and wiring one beside the dispatcher is the documented double-send.
 *
 * ⚠ WHAT THE KEY DOES AND DOES NOT DEDUPLICATE. `dedupeKey` becomes `PlatformNotification.sourceKey`, a
 * unique column, so a repeat dispatch cannot create a second IN-APP row. It does not gate email, SMS or
 * push: the dispatcher sends those per user whether or not the in-app row was new. This notice goes out
 * once because a reversal SUCCEEDS once — a retried request is refused `ALREADY_REVERSED` before any
 * notice is sent — not because of the key.
 *
 * ⚠ NO REASON AND NO TEAM NAMES. The commissioner's reason is recorded on the reversal row for
 * commissioners; broadcast to every member, "collusion between A and B" is an accusation, not a notice.
 * The message says what happened to the league and points at the league, matching the existing
 * "Trade processed" notice, which names nobody either.
 *
 * ⚠ AND A DIRECT NOTICE TO THE TWO MANAGERS WHOSE TRADE IT WAS. The announcement names nobody, so on its own
 * the two people whose rosters just changed learn it the same way as everyone else. They also get a
 * `trade_reversed` notice through the notification engine — the path tradeService uses to tell a manager their
 * offer was accepted, rejected or countered — under the `trade_accept_reject` toggle. It carries no reason
 * either. Its in-app row cannot collide with the announcement's: `ingest` sets no `sourceKey` column. Placeholder
 * owners are skipped, and so is a commissioner reversing a trade they were part of.
 */

import { publishLeagueFanoutEvent } from '@/lib/league-events/publisher'
import { ingest, tradeEvent } from '@/lib/notification-engine'
import { isAiManagerPlatformUserId, isOrphanPlatformUserId } from '@/lib/orphan-ai-manager/orphan-platform-ids'
import { prisma } from '@/lib/prisma'

export type TradeReversalEngine = 'generic' | 'native'

export const TRADE_REVERSED_TITLE = 'Trade reversed'
export const TRADE_REVERSED_MESSAGE =
  'A commissioner reversed a trade. Both rosters were restored to how they were before it.'

export const TRADE_REVERSED_PARTY_TITLE = 'Your trade was reversed'
export const TRADE_REVERSED_PARTY_MESSAGE =
  'A commissioner reversed a trade you were part of. Your roster was restored to how it was before the trade.'

/** Unclaimed and AI-run slots carry a placeholder in the owner column, not a person. */
function isNotifiableUserId(id: string | null | undefined): id is string {
  const value = String(id ?? '').trim()
  if (!value) return false
  return !value.startsWith('roster:') && !isOrphanPlatformUserId(value) && !isAiManagerPlatformUserId(value)
}

/** The app user ids of the managers on both sides of the trade, placeholders removed. */
export async function resolveTradeReversalPartyUserIds(input: {
  tradeId: string
  engine: TradeReversalEngine
}): Promise<string[]> {
  const ids =
    input.engine === 'generic'
      ? await prisma.afLeagueTrade
          .findUnique({
            where: { id: input.tradeId },
            select: {
              proposerRoster: { select: { platformUserId: true } },
              receiverRoster: { select: { platformUserId: true } },
            },
          })
          .then((trade) => [trade?.proposerRoster?.platformUserId, trade?.receiverRoster?.platformUserId])
      : await prisma.redraftTradeProposal
          .findUnique({
            where: { id: input.tradeId },
            select: {
              proposerRoster: { select: { ownerId: true } },
              receiverRoster: { select: { ownerId: true } },
            },
          })
          .then((proposal) => [proposal?.proposerRoster?.ownerId, proposal?.receiverRoster?.ownerId])
  return [...new Set(ids.filter(isNotifiableUserId))]
}

/** Tell the two managers directly. Returns who was addressed. */
export async function notifyTradeReversalParties(input: {
  leagueId: string
  tradeId: string
  engine: TradeReversalEngine
  actorUserId: string
}): Promise<string[]> {
  const parties = await resolveTradeReversalPartyUserIds(input)
  // A commissioner who reversed a trade they were part of does not need telling what they just did.
  const recipients = parties.filter((id) => id !== input.actorUserId)
  if (recipients.length === 0) return []
  await ingest(
    tradeEvent({
      userIds: recipients,
      leagueId: input.leagueId,
      type: 'trade_reversed',
      tradeId: input.tradeId,
      title: TRADE_REVERSED_PARTY_TITLE,
      body: TRADE_REVERSED_PARTY_MESSAGE,
    }),
  )
  return recipients
}

export async function publishTradeReversalNotice(input: {
  leagueId: string
  tradeId: string
  /** The `TradeReversal.noticeKey` returned by the reversal — never rebuilt here. */
  noticeKey: string
  engine: TradeReversalEngine
  actorUserId: string
}): Promise<void> {
  // Two independent deliveries: one failing must not cost the other. The first failure still propagates,
  // because the route is where a post-commit notice failure gets logged.
  const outcomes = await Promise.allSettled([
    publishLeagueFanoutEvent({
      leagueId: input.leagueId,
      eventType: input.engine === 'generic' ? 'af_trade_reversed' : 'redraft_trade_reversed',
      title: TRADE_REVERSED_TITLE,
      message: TRADE_REVERSED_MESSAGE,
      category: 'league_announcements',
      visibility: 'all_members',
      actorUserId: input.actorUserId,
      meta: { tradeId: input.tradeId, engine: input.engine },
      actionHref: `/league/${input.leagueId}`,
      actionLabel: 'Open league',
      dedupeKey: input.noticeKey,
    }),
    notifyTradeReversalParties({
      leagueId: input.leagueId,
      tradeId: input.tradeId,
      engine: input.engine,
      actorUserId: input.actorUserId,
    }),
  ])
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') throw outcome.reason
  }
}
