import type { Prisma } from '@prisma/client'
import type { AuctionState, SlotOrderEntry } from '@/lib/live-draft-engine/types'
import { loadPlayerPools } from './load'
import { poolOf } from './policy'

export async function validateCurrentPoolOwnership(db: Prisma.TransactionClient, leagueId: string, settings: unknown) {
  const activeBoards = { leagueId, status: { in: ['pre_draft', 'paused', 'in_progress'] } }
  // Hold each board while validating the layout. An in-flight pick or bid must see this revision.
  await db.draftSession.updateMany({ where: activeBoards, data: { version: { increment: 1 } } })
  const season = await db.redraftSeason.findFirst({ where: { leagueId }, orderBy: { season: 'desc' }, select: { id: true } })
  const pools = await loadPlayerPools(leagueId, { db, settings, seasonId: season?.id })
  const holdings = season ? await db.redraftRosterPlayer.findMany({
    where: { roster: { seasonId: season.id }, droppedAt: null }, select: { rosterId: true, playerId: true },
  }) : []
  const copy = (rosterId: string, playerId: string) => JSON.stringify([poolOf(pools, rosterId), playerId])
  const claimed = new Set<string>()
  for (const p of holdings) {
    const key = copy(p.rosterId, p.playerId)
    if (claimed.has(key)) throw new Error('This layout puts two owned copies of a player in the same pool.')
    claimed.add(key)
  }

  const boards = await db.draftSession.findMany({
    where: activeBoards,
    select: { auctionState: true, slotOrder: true, picks: { select: { rosterId: true, playerId: true, playerName: true, position: true } } },
  })
  for (const board of boards) {
    const used = new Set(claimed)
    for (const p of board.picks) {
      if (!p.playerName.trim() || p.position === 'SKIP') continue
      const key = copy(p.rosterId, p.playerId || p.playerName.trim().toLowerCase())
      if (used.has(key)) throw new Error('This layout conflicts with players already drafted or rostered in the same pool.')
      used.add(key)
    }
    const auction = board.auctionState as unknown as AuctionState | null
    if (!auction?.currentNomination) continue
    const order = auction.nominationOrder?.length ? auction.nominationOrder : board.slotOrder as unknown as SlotOrderEntry[]
    const nominator = order[auction.nominationOrderIndex]?.rosterId
    const player = auction.currentNomination
    if (!nominator || used.has(copy(nominator, player.playerId || player.playerName.trim().toLowerCase()))) {
      throw new Error('This layout puts the current auction nomination in a pool where the player is already owned.')
    }
    if (auction.currentBidderRosterId && poolOf(pools, nominator) !== poolOf(pools, auction.currentBidderRosterId)) {
      throw new Error('This layout separates the winning bidder from the current auction nomination.')
    }
  }
}

