/**
 * Zombie Universe config and CRUD (PROMPT 353).
 * Universe = group of leagues in levels (Gamma, Beta, Alpha).
 */

import { prisma } from '@/lib/prisma'

export interface ZombieUniverseSettings {
  leagueCount?: number
  levelNames?: string[]
  teamsPerLeague?: number
  movementPromoteCount?: number
  movementRelegateCount?: number
  tieBreakers?: string[]
}

export async function createZombieUniverse(input: {
  name: string
  sport?: string
  settings?: ZombieUniverseSettings
}) {
  return prisma.zombieUniverse.create({
    data: {
      name: input.name,
      sport: input.sport ?? 'NFL',
      settings: (input.settings ?? {}) as object,
    },
  })
}

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
