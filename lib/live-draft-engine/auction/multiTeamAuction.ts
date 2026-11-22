/**
 * Auction drafts for a manager who runs several teams in the league.
 *
 * A snake draft can follow the clock: whichever of a manager's teams is up is the team that picks. An
 * auction cannot. Any team may bid at any moment and a bid spends that team's budget, so the team is
 * never guessed:
 *   - the team named on the request, when the manager runs it;
 *   - to NOMINATE, the manager's team whose turn it is to nominate;
 *   - the team they last switched to;
 *   - otherwise refused, and the manager is asked to choose.
 * And a manager's team may not outbid another of their own teams: two budgets under one hand would bid
 * a player up against nobody.
 *
 * A manager with one team is that team, as before.
 */
import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { ACTING_TEAM_FIELD, ACTING_TEAM_HEADER, rememberedActiveTeamIds } from '@/lib/league/viewerTeams'
import { getCurrentUserRosterIdsForLeague } from '../auth'
import type { SlotOrderEntry } from '../types'
import { getAuctionNominationOrder, getAuctionStateFromSession } from './AuctionEngine'

export const AUCTION_TEAM_REQUIRED_MESSAGE = 'You run more than one team in this league. Choose which team this is for.'
export const AUCTION_OWN_TEAM_BID_MESSAGE = 'Your other team already holds the high bid on this player.'

export function chooseAuctionRosterId(input: {
  rosterIds: readonly string[]
  purpose: 'bid' | 'nominate'
  requestedRosterId?: string | null
  nominatorRosterId?: string | null
  rememberedRosterIds?: readonly string[]
}): string | null {
  const mine = input.rosterIds
  if (mine.length <= 1) return mine[0] ?? null
  const requested = String(input.requestedRosterId ?? '').trim()
  if (requested) return mine.includes(requested) ? requested : null
  if (input.purpose === 'nominate' && input.nominatorRosterId && mine.includes(input.nominatorRosterId)) return input.nominatorRosterId
  return (input.rememberedRosterIds ?? []).find((id) => mine.includes(id)) ?? null
}

/** True when the high bid belongs to ANOTHER team this manager runs. */
export function isBidAgainstOwnTeam(input: { bidderRosterId: string; currentBidderRosterId: string | null | undefined; rosterIds: readonly string[] }): boolean {
  const high = input.currentBidderRosterId
  return Boolean(high) && high !== input.bidderRosterId && input.rosterIds.includes(high as string)
}

/** The team a request names explicitly: the header, `?rosterId=`, or `rosterId` in the body. Never the remembered team. */
export function namedRosterId(
  req: { headers?: { get(name: string): string | null } | null; nextUrl?: { searchParams?: URLSearchParams | null } | null } | null | undefined,
  body?: unknown,
): string | null {
  const header = req?.headers?.get?.(ACTING_TEAM_HEADER)?.trim()
  if (header) return header
  const query = req?.nextUrl?.searchParams?.get?.(ACTING_TEAM_FIELD)?.trim()
  if (query) return query
  const value = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>)[ACTING_TEAM_FIELD] : null
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

type AuctionActor =
  | { ok: true; rosterId: string; rosterIds: string[]; currentBidderRosterId: string | null }
  | { ok: false; status: number; code: 'NO_TEAM' | 'TEAM_REQUIRED' | 'OWN_TEAM_BID'; error: string; rosterIds: string[] }

/** The team this manager is bidding or nominating for, or why it cannot be decided. */
export async function resolveAuctionActor(input: {
  leagueId: string
  userId: string
  purpose: 'bid' | 'nominate'
  requestedRosterId?: string | null
}): Promise<AuctionActor> {
  const rosterIds = await getCurrentUserRosterIdsForLeague(input.leagueId, input.userId)
  if (rosterIds.length === 0) return { ok: false, status: 403, code: 'NO_TEAM', error: 'No roster for this league', rosterIds }
  if (rosterIds.length === 1) return { ok: true, rosterId: rosterIds[0]!, rosterIds, currentBidderRosterId: null }

  const session = await prisma.draftSession.findFirst({
    where: { leagueId: input.leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: { slotOrder: true, auctionState: true },
  })
  const state = session ? getAuctionStateFromSession(session) : null
  const slotOrder = (Array.isArray(session?.slotOrder) ? session.slotOrder : []) as unknown as SlotOrderEntry[]
  const order = getAuctionNominationOrder(slotOrder, state)
  const index = order.length > 0 ? ((Math.floor(state?.nominationOrderIndex ?? 0) % order.length) + order.length) % order.length : 0
  const currentBidderRosterId = typeof state?.currentBidderRosterId === 'string' && state.currentBidderRosterId ? state.currentBidderRosterId : null

  const rosterId = chooseAuctionRosterId({
    rosterIds,
    purpose: input.purpose,
    requestedRosterId: input.requestedRosterId,
    nominatorRosterId: order[index]?.rosterId ?? null,
    rememberedRosterIds: await rememberedActiveTeamIds(),
  })
  if (!rosterId) return { ok: false, status: 409, code: 'TEAM_REQUIRED', error: AUCTION_TEAM_REQUIRED_MESSAGE, rosterIds }
  if (input.purpose === 'bid' && isBidAgainstOwnTeam({ bidderRosterId: rosterId, currentBidderRosterId, rosterIds })) {
    return { ok: false, status: 409, code: 'OWN_TEAM_BID', error: AUCTION_OWN_TEAM_BID_MESSAGE, rosterIds }
  }
  return { ok: true, rosterId, rosterIds, currentBidderRosterId }
}
