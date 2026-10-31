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
import { prisma } from '@/lib/prisma'
import {
  describeTradeTeamMoves,
  isMultiTeamTrade,
  joinTeamNames,
  tradeParticipantRosterIds,
  tradeTeamMoves,
  type RedraftTradeParticipantsShape,
} from '@/lib/redraft/tradeParticipants'

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

/**
 * 🛑 THE OUTCOMES THAT END OR SETTLE A MULTI-TEAM TRADE, NAMING EVERY TEAM.
 *
 * Titles and bodies are English server copy, like every notice above; nothing here is shown through
 * the i18n dictionary. Each body names every team in the trade (and, once it is processed, what each
 * team got), because a 3- or 4-team trade has no DM card where a manager could look that up.
 *
 *   commissioner veto      app/api/redraft/trade-votes (`commissioner_veto`) — key `vetoed`, the same
 *                          event key as app/api/redraft/trades/veto, so one ruling is one notice
 *   league vote veto       app/api/redraft/trade-votes (`vote_veto` reaching the threshold)
 *   cancelled / expired    app/api/redraft/trade-votes, before every team has accepted
 *   processed              lib/redraft/finalizeRedraftTrade.ts — the ONE settlement every path uses
 *                          (accept under no_veto, commissioner approval, a passed league vote, the
 *                          review window ending), so an approval is told once, as "processed"
 */
export const MULTI_TEAM_TRADE_LEAGUE_VETOED_TITLE = 'Trade vetoed'
export const MULTI_TEAM_TRADE_CANCELLED_TITLE = 'Trade cancelled'
export const MULTI_TEAM_TRADE_EXPIRED_TITLE = 'Trade expired'
export const MULTI_TEAM_TRADE_PROCESSED_TITLE = 'Trade processed'

/** Who settled it, as finalizeRedraftTrade records it (`SnapshotActorRole`). */
export type MultiTeamTradeSettledBy = 'user' | 'commissioner' | 'league_vote' | 'review_window'

export const multiTeamTradeVetoedBody = (teams: string) =>
  `The commissioner vetoed the multi-team trade between ${teams}, so it will not go through.`
export const multiTeamTradeLeagueVetoedBody = (teams: string, vetoCount: number, threshold: number) =>
  `The league voted to veto the multi-team trade between ${teams} (${vetoCount} of ${threshold} veto votes), so it will not go through.`
export const multiTeamTradeCancelledBody = (teams: string, proposer: string) =>
  `${proposer} cancelled the multi-team trade between ${teams}, so it will not go through.`
export const multiTeamTradeExpiredBody = (teams: string) =>
  `The multi-team trade between ${teams} expired before every team accepted it, so it will not go through.`
export function multiTeamTradeProcessedBody(teams: string, settledBy: MultiTeamTradeSettledBy, moves: readonly string[]): string {
  const how =
    settledBy === 'commissioner'
      ? `The commissioner approved the multi-team trade between ${teams}, and it went through.`
      : settledBy === 'league_vote'
        ? `The league vote approved the multi-team trade between ${teams}, and it went through.`
        : settledBy === 'review_window'
          ? `The review window for the multi-team trade between ${teams} ended with no veto, and it went through.`
          : `Every team accepted the multi-team trade between ${teams}, and it went through.`
  return moves.length ? `${how} Rosters are updated: ${moves.join('; ')}.` : `${how} Rosters are updated.`
}

export type MultiTeamNoticeAsset = {
  fromRosterId: string
  toRosterId: string
  assetType: string
  playerName?: string | null
  pickSeason?: number | null
  pickRound?: number | null
  metadata?: unknown
}

/** One asset, in the same words the Chimmy trade grounding uses (lib/chimmy-trade/pendingTradeDecisionGrounding.ts). */
export function multiTeamNoticeAssetLabel(a: MultiTeamNoticeAsset): string {
  if (a.playerName) return a.playerName
  if (a.assetType === 'player') return 'a player'
  if (a.assetType === 'faab') {
    const amount = Number((a.metadata as Record<string, unknown> | null)?.amount ?? 0) || 0
    return `${amount} FAAB`
  }
  if (a.assetType === 'draft_pick') {
    return a.pickSeason && a.pickRound ? `a ${a.pickSeason} round ${a.pickRound} pick` : 'a draft pick'
  }
  if (a.assetType === 'future_consideration') return 'future considerations'
  return a.assetType
}

/**
 * Tell every team in a multi-team trade how it ended. Reads the teams once (names and managers), lets
 * `body` word the outcome with every team named, and hands it to `notifyMultiTeamTradeParties`.
 *
 * 🛑 BEST-EFFORT, AND THIS IS THE ONE GUARD: it never rejects. The trade has already been decided or
 * settled when this runs, so a failed roster read or a broken body must never fail the approve, veto
 * or settlement that called it — callers await it and do not catch.
 *
 * A two-team trade is not a multi-team trade and is never told here: it keeps its DM status flow.
 */
export async function notifyMultiTeamTradeOutcome(input: {
  proposal: RedraftTradeParticipantsShape & { id: string; leagueId: string; assets?: readonly MultiTeamNoticeAsset[] | null }
  actorUserId?: string | null
  key: string
  title: string
  body: (ctx: { teams: string; nameOf: (rosterId: string) => string; moves: string[] }) => string
}): Promise<void> {
  try {
    const { proposal } = input
    if (!isMultiTeamTrade(proposal)) return
    const rosterIds = tradeParticipantRosterIds(proposal)
    const rows = await prisma.redraftRoster.findMany({
      where: { id: { in: rosterIds } },
      select: { id: true, ownerId: true, teamName: true, ownerName: true },
    })
    const byId = new Map(rows.map((r) => [r.id, r]))
    const nameOf = (id: string) => {
      const r = byId.get(id)
      return r?.teamName?.trim() || r?.ownerName?.trim() || 'a team'
    }
    const moves = describeTradeTeamMoves(tradeTeamMoves(proposal, proposal.assets ?? []), nameOf, multiTeamNoticeAssetLabel)
    notifyMultiTeamTradeParties({
      proposalId: proposal.id,
      leagueId: proposal.leagueId,
      userIds: rosterIds.map((id) => byId.get(id)?.ownerId),
      actorUserId: input.actorUserId,
      key: input.key,
      title: input.title,
      body: input.body({ teams: joinTeamNames(rosterIds.map(nameOf)), nameOf, moves }),
    })
  } catch (e) {
    console.error('[redraft] multi-team trade notice failed', input.proposal?.id, input.key, e)
  }
}
