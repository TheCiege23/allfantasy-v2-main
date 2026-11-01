import { prisma } from '@/lib/prisma'

export type ZombieTradeRestriction = 'zombie_trade_blocked' | null

/** 2025 rules: Survivors and Whisperers may trade. Zombies may not, including pending offers. */
export async function getZombieTradeRestriction(leagueId: string, rosterIds: readonly string[]): Promise<ZombieTradeRestriction> {
  const uniqueRosterIds = [...new Set(rosterIds.filter(Boolean))]
  if (!uniqueRosterIds.length) return null
  const teams = await prisma.zombieLeagueTeam.findMany({
    where: { leagueId, rosterId: { in: uniqueRosterIds } }, select: { status: true },
  })
  return teams.some(team => String(team.status).trim().toLowerCase() === 'zombie') ? 'zombie_trade_blocked' : null
}
