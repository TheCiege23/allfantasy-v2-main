import { prisma } from '@/lib/prisma'

/** Roster id → display label for scoring UI */
export async function buildRosterLabelMap(leagueId: string): Promise<Map<string, string>> {
  const [teams, rosters] = await Promise.all([
    prisma.leagueTeam.findMany({ where: { leagueId } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
  ])
  const map = new Map<string, string>()
  for (const r of rosters) {
    const t = teams.find(x => x.legacyRosterId === r.id) ?? teams.find(x => x.externalId === r.id) ?? teams.find((x) => x.platformUserId === r.platformUserId)
    const label = (t?.teamName?.trim() || t?.ownerName?.trim() || `Team ${r.id.slice(0, 6)}`).trim()
    map.set(r.id, label)
  }
  return map
}
