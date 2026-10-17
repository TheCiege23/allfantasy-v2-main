import 'server-only'

import { prisma } from '@/lib/prisma'
import { assertLiveDraftContext } from '@/lib/draft/resolve-draft-context'
import {
  nominatePlayer as nominateAuctionPlayer,
  placeBid as placeAuctionBid,
  resolveAuctionWin,
  getAuctionStateFromSession,
  getBudgetsFromSession,
} from '@/lib/live-draft-engine/auction/AuctionEngine'
import { selectRowForExternalRef } from '@/lib/player-match/authoritativePlayerRow'

export type NominationResult = {
  success: boolean
  error?: string
}

export type BidResult = {
  success: boolean
  error?: string
}

export type AuctionResult = {
  success: boolean
  error?: string
  sold?: boolean
  winnerTeamId?: string
  amount?: number
}

/**
 * The `SportsPlayer` row a draft's player id names, IN THE LEAGUE'S SPORT. Shared with the snake
 * draft worker so the two cannot disagree.
 *
 * 🛑 `externalId` IS PER SPORT AND PER SOURCE. Measured on production 2026-10-12: 18,731
 * `externalId`s exist in more than one sport, and 372 `(sport, externalId)` pairs carry rows from
 * several sources. The old unscoped `findFirst` returned whichever row Postgres reached first — an
 * NFL pick could be filed as the NHL player of that number. Our own id wins outright; otherwise the
 * `externalId` rows go through `selectRowForExternalRef`, which refuses (null) when they describe
 * different men rather than pick one at random.
 */
export async function resolveSportsPlayerRow(sport: string, playerId: string) {
  const scoped = String(sport ?? '').trim().toUpperCase()
  if (!scoped || !playerId) return null
  const rows = await prisma.sportsPlayer.findMany({
    where: {
      sport: scoped,
      OR: [{ id: playerId }, { externalId: playerId }],
    },
    select: {
      id: true,
      name: true,
      position: true,
      team: true,
      sport: true,
      externalId: true,
      source: true,
      sleeperId: true,
      fetchedAt: true,
    },
  })
  // Belt and braces for the `where`: another sport's row never answers.
  const inSport = rows.filter((row) => String(row.sport ?? '').toUpperCase() === scoped)
  return inSport.find((row) => row.id === playerId)
    ?? selectRowForExternalRef(inSport.filter((row) => row.externalId === playerId))
}

async function resolveAuctionPlayerFromId(sport: string, playerId: string) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true, name: true, position: true, team: true },
  })

  if (player?.id) {
    return {
      playerId: player.id,
      playerName: player.name,
      position: player.position ?? '',
      team: player.team ?? null,
    }
  }

  const sportsPlayer = await resolveSportsPlayerRow(sport, playerId)

  if (sportsPlayer?.id) {
    return {
      playerId: sportsPlayer.id,
      playerName: sportsPlayer.name ?? playerId,
      position: sportsPlayer.position ?? '',
      team: sportsPlayer.team ?? null,
    }
  }

  return null
}

export async function nominateDraftPlayer(
  draftId: string,
  teamId: string,
  playerId: string
): Promise<NominationResult> {
  const context = await assertLiveDraftContext(draftId)
  const player = await resolveAuctionPlayerFromId(context.sport, playerId)
  if (!player) {
    return { success: false, error: 'Player not found for nomination' }
  }

  return nominateAuctionPlayer(
    context.leagueId,
    {
      playerId: player.playerId,
      playerName: player.playerName,
      position: player.position,
      team: player.team,
    },
    teamId
  )
}

export async function placeDraftBid(
  draftId: string,
  teamId: string,
  amount: number
): Promise<BidResult> {
  const context = await assertLiveDraftContext(draftId)
  return placeAuctionBid(context.leagueId, teamId, amount)
}

export async function closeDraftAuction(
  draftId: string
): Promise<AuctionResult> {
  const context = await assertLiveDraftContext(draftId)
  const result = await resolveAuctionWin(context.leagueId, { force: true })
  return {
    success: result.success,
    error: result.error,
    sold: result.sold,
    winnerTeamId: result.winnerRosterId,
    amount: result.amount,
  }
}

export async function getAuctionSnapshot(draftId: string) {
  const context = await assertLiveDraftContext(draftId)
  const session = await prisma.draftSession.findUnique({
    where: { id: context.draftId },
    select: {
      auctionBudgetPerTeam: true,
      auctionBudgets: true,
      auctionState: true,
      slotOrder: true,
      timerEndAt: true,
      timerSeconds: true,
    },
  })

  if (!session) {
    return null
  }

  return {
    budgets: getBudgetsFromSession(session),
    state: getAuctionStateFromSession(session),
    slotOrder: session.slotOrder,
    timerEndAt: session.timerEndAt?.toISOString() ?? null,
    timerSeconds: session.timerSeconds ?? null,
  }
}
