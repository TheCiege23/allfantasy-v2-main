import { prisma } from '@/lib/prisma'
import type { CollegeSport } from '@/lib/workers/providers/collegeFinalBoxes'

const select = { id: true, sport: true, season: true, settings: true, platform: true } as const

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** A Fantrax re-import can replace both AF UUIDs. Resolve within the original owner and tenant. */
export async function resolveCollegeRecheckLeague(configData: unknown, sport: CollegeSport) {
  const config = record(configData)
  const binding = record(config.fantraxImports)[sport]
  if (binding === undefined) {
    const id = config[sport]
    if (typeof id !== 'string' || !id) throw new Error(sport + ': missing monitored league')
    return prisma.league.findUniqueOrThrow({ where: { id }, select })
  }

  const { sourceLeagueId, season, userId, tenantId } = record(binding)
  if (typeof sourceLeagueId !== 'string' || !sourceLeagueId || typeof season !== 'number' || !Number.isInteger(season) ||
      typeof userId !== 'string' || !userId || typeof tenantId !== 'string' || !tenantId) {
    throw new Error(sport + ': invalid monitored Fantrax import binding')
  }
  const imports = await prisma.fantraxLeague.findMany({
    where: { sourceLeagueId, appUserId: userId, season },
    select: { id: true },
  })
  const matches = await prisma.league.findMany({
    where: { sport, season, userId, tenantId, platform: 'fantrax', platformLeagueId: { in: imports.map(row => row.id) } },
    select, take: 2,
  })
  if (matches.length !== 1) throw new Error(sport + ': expected one monitored Fantrax league, found ' + matches.length)
  return matches[0]!
}
