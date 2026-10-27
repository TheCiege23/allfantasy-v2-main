import { prisma } from '@/lib/prisma'

export type ZombieTradeRestriction = 'zombie_trade_blocked' | 'whisperer_trade_blocked' | null

/**
 * The first completed infection permanently locks the Whisperer out of trades for this season.
 * Read the infection ledger rather than current Zombie count: a later serum revival cannot reopen
 * trading. The commissioner can disable the existing zombieTradeBlocked league rule.
 */
export async function getZombieTradeRestriction(
  leagueId: string,
  rosterIds: readonly string[],
): Promise<ZombieTradeRestriction> {
  const uniqueRosterIds = [...new Set(rosterIds.filter(Boolean))]
  if (uniqueRosterIds.length === 0) return null

  const config = await prisma.zombieLeagueConfig.findUnique({
    where: { leagueId },
    select: { zombieTradeBlocked: true },
  })
  if (!config?.zombieTradeBlocked) return null

  const teams = await prisma.zombieLeagueTeam.findMany({
    where: { leagueId, rosterId: { in: uniqueRosterIds } },
    select: { status: true },
  })
  if (teams.some((team) => team.status === 'Zombie')) return 'zombie_trade_blocked'
  if (!teams.some((team) => team.status === 'Whisperer')) return null

  const zombieLeague = await prisma.zombieLeague.findUnique({
    where: { leagueId },
    select: { id: true },
  })
  if (!zombieLeague) return null

  // A commissioner override or an in-flight infection can make a Zombie before its history row exists.
  const activeZombies = await prisma.zombieLeagueTeam.count({ where: { leagueId, status: 'Zombie' } })
  if (activeZombies > 0) return 'whisperer_trade_blocked'

  const infections = await prisma.zombieInfectionEvent.count({
    where: { zombieLeagueId: zombieLeague.id },
  })
  return infections > 0 ? 'whisperer_trade_blocked' : null
}
