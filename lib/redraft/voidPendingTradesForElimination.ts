import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { queueTradeStatusInDm } from '@/lib/chat-notifications/tradeOfferDm'
import { notifyMultiTeamTradeParties } from '@/lib/redraft/multiTeamTradeNotices'
import { isMultiTeamTrade, joinTeamNames, tradeParticipantRosterIds } from '@/lib/redraft/tradeParticipants'

/**
 * The notice every OTHER team in a voided offer gets. English server copy, like every trade notice in
 * lib/redraft/multiTeamTradeNotices.ts; nothing here goes through the i18n dictionary.
 */
export const ELIMINATION_VOID_TITLE = 'Trade cancelled'
/** Dedupe event key: `redraft_trade:<id>:voided_eliminated`, beside #3070's `cancelled` / `expired` / `vetoed`. */
export const ELIMINATION_VOID_KEY = 'voided_eliminated'
export const eliminationVoidBody = (teams: string, eliminated: string) =>
  `The trade offer between ${teams} was cancelled because ${eliminated} was eliminated, so it will not go through.`
export const eliminationVoidMultiTeamBody = (teams: string, eliminated: string) =>
  `The multi-team trade between ${teams} was cancelled because ${eliminated} was eliminated, so it will not go through.`
/** The line under a two-team offer card ("The league pulled the trade offer. <detail>"). */
export const eliminationVoidDmDetail = (eliminated: string) => `${eliminated} was eliminated, so the offer was cancelled.`

/**
 * Cancels all pending redraft trades touching an eliminated roster.
 * Covers both the canonical RedraftTradeProposal system and legacy RedraftLeagueTrade
 * records (which may exist as audit mirrors from earlier in the season).
 *
 * Every OTHER team in each cancelled proposal is told why (see `notifyEliminationVoids`). Best-effort:
 * the void has happened by then, and a failed notice never fails it or changes the count returned.
 */
export async function voidPendingRedraftTradesForRoster(
  leagueId: string,
  rosterId: string,
  opts?: {
    /** Whoever eliminated the team (a commissioner removing a manager). Never told about their own action. */
    actorUserId?: string | null
  },
): Promise<number> {
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (!season) return 0

  const now = new Date()

  // A multi-team trade the roster is a third or fourth team in is voided too.
  const touchesRoster: Prisma.RedraftTradeProposalWhereInput[] = [
    { proposerRosterId: rosterId },
    { receiverRosterId: rosterId },
    { additionalRosterIds: { has: rosterId } },
  ]

  // Cancel canonical proposals (the active system)
  const proposalRes = await prisma.redraftTradeProposal.updateMany({
    where: {
      seasonId: season.id,
      status: 'pending',
      OR: touchesRoster,
    },
    data: {
      status: 'cancelled',
      cancelledAt: now,
    },
  })

  // Cancel legacy records (audit mirrors created on acceptance; also any pre-migration records)
  const legacyRes = await prisma.redraftLeagueTrade.updateMany({
    where: {
      seasonId: season.id,
      status: 'pending',
      OR: [{ proposerRosterId: rosterId }, { receiverRosterId: rosterId }],
    },
    data: {
      status: 'void_elimination',
      notes: 'Voided automatically: roster eliminated from league.',
      processedAt: now,
    },
  })

  if (proposalRes.count > 0) {
    await notifyEliminationVoids({ leagueId, seasonId: season.id, rosterId, touchesRoster, cancelledAt: now, actorUserId: opts?.actorUserId })
  }

  return proposalRes.count + legacyRes.count
}

/**
 * 🛑 THE PROPOSALS THIS CALL CANCELLED, AND ONLY THOSE: read back by the exact `cancelledAt` stamp it
 * wrote. A pre-read would also catch an offer accepted or withdrawn between the read and the update, and
 * tell its teams a cancellation that never happened.
 *
 * Who is told: every team in the proposal except the eliminated one (and never the actor). A two-team
 * offer also gets its DM card's `cancelled` line, the status every other two-team ending uses. Legacy
 * `RedraftLeagueTrade` mirrors are not told: each is a copy of a canonical proposal, never a second offer.
 *
 * Never rejects.
 */
async function notifyEliminationVoids(input: {
  leagueId: string
  seasonId: string
  rosterId: string
  touchesRoster: Prisma.RedraftTradeProposalWhereInput[]
  cancelledAt: Date
  actorUserId?: string | null
}): Promise<void> {
  try {
    const voided = await prisma.redraftTradeProposal.findMany({
      where: {
        seasonId: input.seasonId,
        status: 'cancelled',
        cancelledAt: input.cancelledAt,
        OR: input.touchesRoster,
      },
      select: { id: true, leagueId: true, proposerRosterId: true, receiverRosterId: true, additionalRosterIds: true },
    })
    if (voided.length === 0) return

    const rosterIds = [...new Set([input.rosterId, ...voided.flatMap((p) => tradeParticipantRosterIds(p))])]
    const rows = await prisma.redraftRoster.findMany({
      where: { id: { in: rosterIds } },
      select: { id: true, ownerId: true, teamName: true, ownerName: true },
    })
    const byId = new Map(rows.map((r) => [r.id, r]))
    const nameOf = (id: string) => {
      const r = byId.get(id)
      return r?.teamName?.trim() || r?.ownerName?.trim() || 'a team'
    }
    const eliminated = nameOf(input.rosterId)

    for (const p of voided) {
      const participants = tradeParticipantRosterIds(p)
      const teams = joinTeamNames(participants.map(nameOf))
      const multiTeam = isMultiTeamTrade(p)
      const others = participants
        .filter((id) => id !== input.rosterId)
        .map((id) => byId.get(id)?.ownerId)
      notifyMultiTeamTradeParties({
        proposalId: p.id,
        leagueId: p.leagueId ?? input.leagueId,
        userIds: others,
        actorUserId: input.actorUserId,
        key: ELIMINATION_VOID_KEY,
        title: ELIMINATION_VOID_TITLE,
        body: multiTeam ? eliminationVoidMultiTeamBody(teams, eliminated) : eliminationVoidBody(teams, eliminated),
      })
      // A multi-team trade has no DM card (lib/redraft/multiTeamTradeNotices.ts), so this is two-team only.
      if (!multiTeam) {
        queueTradeStatusInDm({
          source: 'redraft',
          tradeId: p.id,
          status: 'cancelled',
          actorName: 'The league',
          detail: eliminationVoidDmDetail(eliminated),
        })
      }
    }
  } catch (e) {
    console.error('[redraft] elimination void notice failed', input.leagueId, input.rosterId, e)
  }
}
