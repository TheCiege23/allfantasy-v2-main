/**
 * A dynasty league keeps its whole roster from one season to the next.
 *
 * 🛑 NOTHING DID THIS. At season end `triggerKeeperOffseason` built next season's roster shells
 * EMPTY and opened a keeper window capped at `League.keeperCount` (3 by default, 0 for a league
 * made by the wizard) — so a dynasty league reached year two with every manager holding at most
 * three of their players, and the rest back in the pool. That is a keeper league, not a dynasty.
 *
 * Rosters are matched by `ownerId`, which `ensureNextRedraftSeasonShell` copies from the
 * outgoing season, so an orphaned team (`roster:<id>`) is carried like any other.
 *
 * Idempotent: a player already active on the incoming roster is not copied again, so a retry,
 * or the offseason trigger and the next-draft action both running, cannot duplicate anyone.
 *
 * 🛑 AND A PLAYER THE INCOMING SEASON HAS SEEN AT ALL IS NOT COPIED AGAIN — DROPPED OR ON ANOTHER TEAM.
 * This runs twice: at season end (`triggerKeeperOffseason`) and again when the rookie draft is created
 * (`createNextLeagueDraft`). Between the two, dynasty managers trade, add and drop, and those moves
 * land on the incoming season (`redraftRosterMoveSync`). Checking only "active on the same owner's
 * incoming roster" made the second pass undo them: a player traded A→B was copied back onto A (now on
 * both teams), and a player A dropped was copied back onto A. The outgoing season is frozen, so once
 * the incoming season has a row for a player — any roster, dropped or not — that player has already
 * been carried and every later move is the incoming season's to record.
 */
import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadPlayerPools, lockPlayerPools } from '@/lib/league/player-pools/load'
import { poolOf, readPlayerPoolScope, type PlayerPools } from '@/lib/league/player-pools/policy'

import { isDynastyFamilyLeague } from './dynastyFamily'

export { isDynastyFamilyLeague }

export type DynastyCarryoverResult = {
  rostersMatched: number
  playersCopied: number
  playersAlreadyPresent: number
  /** Outgoing owners with no roster in the incoming season — their players were not carried. */
  unmatchedOwnerIds: string[]
}

export async function carryDynastyRostersForward(
  leagueId: string,
  outgoingSeasonId: string,
  incomingSeasonId: string,
): Promise<DynastyCarryoverResult> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (readPlayerPoolScope(league?.settings) === 'league') {
    return copyRosters(prisma, leagueId, outgoingSeasonId, incomingSeasonId, null)
  }
  return prisma.$transaction(async tx => {
    await lockPlayerPools(tx, leagueId)
    const pools = await loadPlayerPools(leagueId, { db: tx, seasonId: incomingSeasonId })
    return copyRosters(tx, leagueId, outgoingSeasonId, incomingSeasonId, pools)
  }, { timeout: 120_000 })
}

async function copyRosters(
  db: Prisma.TransactionClient,
  leagueId: string,
  outgoingSeasonId: string,
  incomingSeasonId: string,
  pools: PlayerPools,
): Promise<DynastyCarryoverResult> {
  const [outgoing, incoming] = await Promise.all([
    db.redraftRoster.findMany({
      where: { leagueId, seasonId: outgoingSeasonId },
      select: {
        id: true,
        ownerId: true,
        players: {
          where: { droppedAt: null },
          select: {
            playerId: true,
            playerName: true,
            position: true,
            team: true,
            sport: true,
            slotType: true,
            injuryStatus: true,
            byeWeek: true,
            acquisitionType: true,
          },
        },
      },
    }),
    db.redraftRoster.findMany({
      where: { leagueId, seasonId: incomingSeasonId },
      // Dropped rows too: a player dropped in the offseason must not be carried back (see above).
      select: { id: true, ownerId: true, players: { select: { id: true, playerId: true } } },
    }),
  ])

  const incomingByOwner = new Map(incoming.map((r) => [r.ownerId, r]))
  const copyKey = (rosterId: string, playerId: string) => JSON.stringify([poolOf(pools, rosterId), playerId])
  const seenIncoming = new Set(incoming.flatMap(r => r.players.map(p => copyKey(r.id, p.playerId))))
  // A trade can move an existing copy to a different pool between the offseason and rookie-draft passes.
  const incomingIds = new Set(incoming.flatMap(r => r.players.map(p => p.id)))
  const batch: Prisma.RedraftRosterPlayerCreateManyInput[] = []
  const result: DynastyCarryoverResult = {
    rostersMatched: 0,
    playersCopied: 0,
    playersAlreadyPresent: 0,
    unmatchedOwnerIds: [],
  }

  for (const from of outgoing) {
    const to = incomingByOwner.get(from.ownerId)
    if (!to) {
      if (from.players.length > 0) result.unmatchedOwnerIds.push(from.ownerId)
      continue
    }
    result.rostersMatched += 1
    for (const p of from.players) {
      const key = copyKey(to.id, p.playerId)
      const sourceId = pools
        ? 'c' + createHash('sha256').update(JSON.stringify([outgoingSeasonId, incomingSeasonId, from.id, p.playerId])).digest('hex').slice(0, 24)
        : undefined
      if (seenIncoming.has(key) || (sourceId && incomingIds.has(sourceId))) {
        result.playersAlreadyPresent += 1
        continue
      }
      const data = {
        ...(sourceId ? { id: sourceId } : {}),
        rosterId: to.id,
        playerId: p.playerId,
        playerName: p.playerName,
        position: p.position,
        team: p.team,
        sport: p.sport,
        slotType: p.slotType,
        injuryStatus: p.injuryStatus,
        byeWeek: p.byeWeek,
        acquisitionType: p.acquisitionType,
        isKept: true,
      }
      if (pools) batch.push(data)
      else await db.redraftRosterPlayer.create({ data })
      seenIncoming.add(key)
      result.playersCopied += 1
    }
  }

  if (batch.length) await db.redraftRosterPlayer.createMany({ data: batch })
  return result
}
