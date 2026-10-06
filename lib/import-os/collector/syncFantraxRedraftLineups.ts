import { prisma } from '@/lib/prisma'
import { redraftSlotChanges } from '@/lib/league-runtime/redraftSlotType'

/** Source lineup changes must reach the linked scoring projection even when
 * nobody was added or dropped. Native decisions and engine-acquired rows are
 * outside this mirror's write authority. Historical week lineups are untouched.
 */
export async function syncFantraxRedraftLineups(leagueId: string): Promise<number> {
  return prisma.$transaction(async tx => {
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { platform: true } })
    if (league?.platform?.toLowerCase() !== 'fantrax') return 0
    const rosters = await tx.roster.findMany({
      where: { leagueId, redraftRosterId: { not: null } },
      select: { playerData: true, redraftRosterId: true },
    })
    let updated = 0
    for (const roster of rosters) {
      if (!roster.redraftRosterId) continue
      const rows = await tx.redraftRosterPlayer.findMany({
        where: { rosterId: roster.redraftRosterId, droppedAt: null, acquisitionType: 'imported' },
        select: { id: true, playerId: true, position: true, slotType: true },
      })
      const groups = new Map<string, string[]>()
      for (const change of redraftSlotChanges(roster.playerData, rows)) {
        groups.set(change.to, [...(groups.get(change.to) ?? []), change.id])
      }
      for (const [slotType, ids] of groups) {
        const result = await tx.redraftRosterPlayer.updateMany({
          where: { id: { in: ids }, rosterId: roster.redraftRosterId, droppedAt: null, acquisitionType: 'imported',
            roster: { leagueId, season: { league: { platform: { equals: 'fantrax', mode: 'insensitive' } } } },
          },
          data: { slotType },
        })
        updated += result.count
      }
    }
    return updated
  }, { timeout: 60000 })
}
