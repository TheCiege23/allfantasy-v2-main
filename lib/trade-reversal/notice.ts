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
 */

import { publishLeagueFanoutEvent } from '@/lib/league-events/publisher'

export type TradeReversalEngine = 'generic' | 'native'

export const TRADE_REVERSED_TITLE = 'Trade reversed'
export const TRADE_REVERSED_MESSAGE =
  'A commissioner reversed a trade. Both rosters were restored to how they were before it.'

export async function publishTradeReversalNotice(input: {
  leagueId: string
  tradeId: string
  /** The `TradeReversal.noticeKey` returned by the reversal — never rebuilt here. */
  noticeKey: string
  engine: TradeReversalEngine
  actorUserId: string
}): Promise<void> {
  await publishLeagueFanoutEvent({
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
  })
}
