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
 */
import { prisma } from '@/lib/prisma'

const DYNASTY_FAMILY_TYPES = new Set(['dynasty', 'devy', 'c2c'])

/** Dynasty, devy and C2C keep their rosters and hold a rookie draft; `isDynasty` covers legacy rows. */
export function isDynastyFamilyLeague(league: { leagueType?: string | null; isDynasty?: boolean | null }): boolean {
  if (league.isDynasty === true) return true
  return DYNASTY_FAMILY_TYPES.has(String(league.leagueType ?? '').toLowerCase())
}

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
  const [outgoing, incoming] = await Promise.all([
    prisma.redraftRoster.findMany({
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
    prisma.redraftRoster.findMany({
      where: { leagueId, seasonId: incomingSeasonId },
      select: { id: true, ownerId: true, players: { where: { droppedAt: null }, select: { playerId: true } } },
    }),
  ])

  const incomingByOwner = new Map(incoming.map((r) => [r.ownerId, r]))
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
    const present = new Set(to.players.map((p) => p.playerId))
    for (const p of from.players) {
      if (present.has(p.playerId)) {
        result.playersAlreadyPresent += 1
        continue
      }
      await prisma.redraftRosterPlayer.create({
        data: {
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
        },
      })
      present.add(p.playerId)
      result.playersCopied += 1
    }
  }

  return result
}
