/**
 * Zombie Universe config and CRUD (PROMPT 353).
 * Universe = group of leagues in levels (Gamma, Beta, Alpha).
 */

import { prisma } from '@/lib/prisma'

export async function attachLeagueToUniverse(input: {
  universeId: string
  levelId: string
  leagueId: string
  name?: string
  orderInLevel?: number
}) {
  return prisma.zombieLeague.create({
    data: {
      universeId: input.universeId,
      levelId: input.levelId,
      leagueId: input.leagueId,
      name: input.name ?? null,
      orderInLevel: input.orderInLevel ?? 0,
    },
  })
}
