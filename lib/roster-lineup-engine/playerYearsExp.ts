import { prisma } from '@/lib/prisma'
import { ourIdOrSleeperIdWhere, playerRowKeys } from '@/lib/player-identity/externalIdNamespace'

/**
 * Known experience (`SportsPlayer.yearsExp`) by roster player id. 0 is a rookie; a player with no
 * value on file, or whose matching rows disagree, is simply absent — an unknown is never a rookie and
 * never a veteran. Shared by the dynasty rollover housekeeping and the lineup save's taxi check.
 */
export async function loadKnownYearsExp(sports: string[], playerIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (playerIds.length === 0) return out
  const rows = await prisma.sportsPlayer
    .findMany({
      where: {
        sport: { in: sports },
        yearsExp: { not: null },
        // Never a bare id against `externalId`: there a Rolling Insights number names a different player.
        AND: [ourIdOrSleeperIdWhere(playerIds)],
      },
      select: { id: true, sleeperId: true, yearsExp: true },
    })
    .catch(() => [])
  const wanted = new Set(playerIds)
  const seen = new Map<string, Set<number>>()
  for (const r of rows) {
    if (r.yearsExp == null) continue
    for (const key of new Set(playerRowKeys(r))) {
      if (!key || !wanted.has(key)) continue
      const set = seen.get(key) ?? new Set<number>()
      set.add(r.yearsExp)
      seen.set(key, set)
    }
  }
  for (const [key, values] of seen) if (values.size === 1) out.set(key, [...values][0]!)
  return out
}
