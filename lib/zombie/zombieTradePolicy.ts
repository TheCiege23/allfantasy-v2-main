import { prisma } from '@/lib/prisma'

export type ZombieTradeRestriction = 'zombie_trade_blocked' | 'whisperer_trade_blocked' | null

/**
 * Whisperers can never trade. The commissioner-controlled Zombie trade block applies separately
 * to Zombies. This policy is shared by the trade transaction gate and the availability API.
 */
export async function getZombieTradeRestriction(
  leagueId: string,
  rosterIds: readonly string[],
): Promise<ZombieTradeRestriction> {
  const uniqueRosterIds = [...new Set(rosterIds.filter(Boolean))]
  if (uniqueRosterIds.length === 0) return null

  const teams = await prisma.zombieLeagueTeam.findMany({
    where: { leagueId, rosterId: { in: uniqueRosterIds } },
    select: { status: true },
  })
  if (teams.some((team) => String(team.status).toLowerCase() === 'whisperer')) {
    return 'whisperer_trade_blocked'
  }
  if (!teams.some((team) => String(team.status).toLowerCase() === 'zombie')) return null

  const config = await prisma.zombieLeagueConfig.findUnique({
    where: { leagueId },
    select: { zombieTradeBlocked: true },
  })
  return config?.zombieTradeBlocked ? 'zombie_trade_blocked' : null
}
