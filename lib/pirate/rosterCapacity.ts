import type { Prisma } from '@prisma/client'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import { isPirateLeague } from './rules'

/** A steal can exceed the cap temporarily; ordinary acquisitions cannot extend that overflow. */
export async function assertPirateAcquisitionCapacity(tx: Prisma.TransactionClient, leagueId: string, rosterId: string) {
  const league = await tx.league.findUnique({ where: { id: leagueId },
    select: { leagueType: true, leagueVariant: true, sport: true, rosterSize: true, settings: true } })
  if (!league || !isPirateLeague(league)) return
  const limit = league.rosterSize && league.rosterSize > 0 ? league.rosterSize
    : resolveRedraftRosterConfig(String(league.sport), league.settings).maxRosterSize
  const count = await tx.redraftRosterPlayer.count({ where: { rosterId, droppedAt: null } })
  if (count >= limit) throw new Error(`Pirate roster is at ${count}/${limit}. Drop a player before acquiring another; no player is dropped automatically.`)
}
