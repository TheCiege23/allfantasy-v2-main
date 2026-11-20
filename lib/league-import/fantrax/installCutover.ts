import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { object, readCutover, type Cutover } from './cutoverPolicy'
import { planCutoverSchedule } from './planCutoverSchedule'

export async function saveCutover(tx: Prisma.TransactionClient, leagueId: string, cutover: Cutover) {
  const json = JSON.stringify(cutover)
  await tx.$executeRaw`UPDATE leagues SET settings = jsonb_set(settings, '{importCarryover,cutover}', ${json}::jsonb) WHERE id = ${leagueId}`
}

export async function installCutover(leagueId: string, seasonId: string) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settings: true, season: true, playoffStartWeek: true } })
    const cut = readCutover(league.settings, league.season ?? -1)
    if (!cut) return
    if (cut.installedSeasonId === seasonId) return cut
    const snapshot = await tx.fantraxLeague.findUniqueOrThrow({ where: { id: cut.snapshotId }, select: { season: true, matchups: true, standings: true, updatedAt: true } })
    if (snapshot.season !== cut.season) throw Error('The source season changed. Review the import again.')
    const season = await tx.redraftSeason.findFirstOrThrow({ where: { id: seasonId, leagueId, season: cut.season } })
    const seats = await tx.roster.findMany({ where: { leagueId, redraftRoster: { seasonId } }, select: { id: true, redraftRosterId: true } })
    if (seats.length !== Object.keys(cut.teams).length) throw Error('Every new franchise must have a native season roster before continuing.')
    const playoffStart = league.playoffStartWeek ?? season.playoffStartWeek
    const plan = planCutoverSchedule({ leagueId, seasonId, cutover: cut, standings: snapshot.standings,
      fixtures: snapshot.matchups, nativeRosterBySeat: new Map(seats.map(s => [s.id, s.redraftRosterId!])),
      playoffStart, snapshotTime: snapshot.updatedAt })
    const existing = await tx.redraftMatchup.findMany({ where: { seasonId }, select: { id: true, status: true, homeScore: true, awayScore: true, lineupSnapshots: true } })
    if (existing.some(m => m.status !== 'scheduled' || m.homeScore || m.awayScore || Object.keys(object(m.lineupSnapshots)).length)) throw Error('Native games already have activity. The existing results were preserved.')
    if (existing.length) {
      const removed = await tx.redraftMatchup.deleteMany({ where: { seasonId, id: { in: existing.map(m => m.id) }, status: 'scheduled', homeScore: 0, awayScore: 0 } })
      if (removed.count !== existing.length) throw Error('The native schedule changed. Retry the conversion.')
    }
    await tx.redraftMatchup.createMany({ data: plan.rows })
    cut.installedSeasonId = seasonId
    cut.officialRanks = plan.ranks
    cut.reason = cut.policy === 'after_open_period' ? 'Fantrax owns this period through its official close.' : 'Waiting for matching locked lineups and individual scores for every franchise.'
    await tx.redraftSeason.update({ where: { id: seasonId }, data: { currentWeek: cut.period, totalWeeks: playoffStart-1, playoffStartWeek: playoffStart } })
    await saveCutover(tx, leagueId, cut)
    return cut
  }, { isolationLevel: 'Serializable', timeout: 60000 })
}
