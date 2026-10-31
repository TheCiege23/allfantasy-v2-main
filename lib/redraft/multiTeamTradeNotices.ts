/**
 * Notices for the teams in a MULTI-TEAM redraft trade.
 *
 * A two-team trade tells its two managers what happened through the offer card in their DM
 * (lib/chat-notifications/tradeOfferDm.ts). That card is a two-manager card in a two-person thread,
 * so a multi-team trade never posts one — and every later status update is a no-op without it. This
 * is the replacement for those teams: one in-app notice, in the same `trade_proposals` category, so
 * the same notification settings govern it.
 *
 * Fire-and-forget through a dynamic import, like the proposal notice: the trade has already been
 * decided when this runs, and a notification failure must never fail or slow the response.
 */
/** A commissioner vetoed a multi-team trade (app/api/redraft/trades/veto). English, like every notice here. */
export const MULTI_TEAM_TRADE_VETOED_TITLE = 'Trade vetoed'
export const MULTI_TEAM_TRADE_VETOED_BODY = 'The commissioner vetoed the multi-team trade, so it will not go through.'

/** An agreed multi-team trade could not be processed when its review window ended (lib/redraft/tradeReviewWindowSweep.ts). */
export const MULTI_TEAM_TRADE_CLOSED_TITLE = 'Trade could not go through'

export function notifyMultiTeamTradeParties(input: {
  proposalId: string
  leagueId: string
  userIds: Array<string | null | undefined>
  /** Never notified about their own action. */
  actorUserId?: string | null
  title: string
  body: string
  /** Distinguishes one notice of this trade from another, for dedupe. */
  key: string
}): void {
  const userIds = [...new Set(input.userIds)].filter(
    (id): id is string =>
      typeof id === 'string' && id.length > 0 && id !== input.actorUserId && !id.startsWith('orphan-') && !id.startsWith('open-slot-'),
  )
  if (userIds.length === 0) return
  try {
    void import('@/lib/notifications/NotificationDispatcher')
      .then(({ dispatchNotification }) =>
        dispatchNotification({
          userIds,
          category: 'trade_proposals',
          productType: 'app',
          type: 'trade_proposed',
          title: input.title,
          body: input.body,
          actionHref: `/league/${encodeURIComponent(input.leagueId)}?view=trades`,
          actionLabel: 'View Trade',
          leagueId: input.leagueId,
          severity: 'medium',
          dedupePrefix: `redraft_trade:${input.proposalId}:${input.key}`,
          meta: { leagueId: input.leagueId, tradeProposalId: input.proposalId },
        }).catch(() => null),
      )
      .catch(() => undefined)
  } catch {
    /* never reaches the trade response */
  }
}
