/** Native season results joined by owner; no current-team totals leaking into an archived season. */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export interface UniverseStandingsRow {
  leagueId: string; rosterId: string; levelId: string; levelName: string; status: string
  wins: number; losses: number; ties: number; totalPoints: number; pointsPerWeek: number[]
  winnings: number; serums: number; weapons: number; weekKilled: number | null; killedByRosterId: string | null
}
export async function getUniverseStandings(universeId: string, season?: number, db: Prisma.TransactionClient = prisma): Promise<UniverseStandingsRow[]> {
  const selectedSeason = season ?? (await db.zombieLeague.aggregate({ where: { universeId }, _max: { season: true } }))._max.season
  const leagues = await db.zombieLeague.findMany({
    where: { universeId, ...(selectedSeason != null ? { season: selectedSeason } : {}) }, include: { level: true },
  })
  const out: UniverseStandingsRow[] = []
  for (const z of leagues) {
    if (!z.levelId || !z.level) continue
    const se = season ?? z.season
    const native = await db.redraftSeason.findUnique({ where: { leagueId_season: { leagueId: z.leagueId, season: se } } })
    const [teams, owners, results, money, resources] = await Promise.all([
      db.zombieLeagueTeam.findMany({ where: { leagueId: z.leagueId } }),
      db.roster.findMany({ where: { leagueId: z.leagueId }, select: { id: true, platformUserId: true } }),
      native ? db.redraftRoster.findMany({ where: { seasonId: native.id } }) : Promise.resolve([]),
      db.zombieWeeklyWinnings.findMany({ where: { leagueId: z.leagueId }, select: { rosterId: true, amount: true } }),
      db.zombieResourceLedger.findMany({ where: { leagueId: z.leagueId }, select: { rosterId: true, resourceType: true, balance: true } }),
    ])
    const ownerByRoster = new Map(owners.map(r => [r.id, r.platformUserId]))
    const resultByOwner = new Map(results.map(r => [r.ownerId, r]))
    for (const team of teams) {
      const result = resultByOwner.get(ownerByRoster.get(team.rosterId) ?? '')
      out.push({
        leagueId: z.leagueId, rosterId: team.rosterId, levelId: z.levelId, levelName: z.level.name,
        status: team.status, wins: result?.wins ?? 0, losses: result?.losses ?? 0, ties: result?.ties ?? 0,
        totalPoints: result?.pointsFor ?? 0, pointsPerWeek: [],
        winnings: money.filter(r => r.rosterId === team.rosterId).reduce((n, r) => n + r.amount, 0),
        serums: resources.filter(r => r.rosterId === team.rosterId && r.resourceType === 'serum').reduce((n, r) => n + r.balance, 0),
        weapons: resources.filter(r => r.rosterId === team.rosterId && r.resourceType === 'weapon').reduce((n, r) => n + r.balance, 0),
        weekKilled: team.weekBecameZombie, killedByRosterId: team.killedByRosterId,
      })
    }
  }
  return out
}
