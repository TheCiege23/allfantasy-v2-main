/** Controlled ownership/pairing and synthetic-stat setup for the disposable Zombie rehearsals. */
import { prisma } from '../../lib/prisma'
import { calculateScoreFromSportConfig, isScoringStarterSlot, recalculateMatchupsForSeasonWeek } from '../../lib/redraft/scoringEngine'
import { loadWeekLineups, weekSlotType } from '../../lib/redraft/weekLineupSlots'
function localOnly() {
  if (!['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL ?? '').hostname)) throw new Error('LOCAL_DISPOSABLE_DATABASE_REQUIRED')
}
/** These scenarios exercise defined Survivor/Horde outcomes; the separate rules tests hold W-v-W for review. */
export async function separateFixtureWhisperers(leagueId: string, seasonId: string, week: number) {
  localOnly()
  const [teams, owners, rosters, matches] = await Promise.all([
    prisma.zombieLeagueTeam.findMany({ where: { leagueId, status: 'Whisperer' }, select: { rosterId: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
    prisma.redraftRoster.findMany({ where: { seasonId }, select: { id: true, ownerId: true } }),
    prisma.redraftMatchup.findMany({ where: { seasonId, week, awayRosterId: { not: null } } }),
  ])
  const users = new Set(owners.filter(r => teams.some(t => t.rosterId === r.id)).map(r => r.platformUserId))
  const whisperers = new Set(rosters.filter(r => users.has(r.ownerId)).map(r => r.id))
  const pair = matches.find(m => whisperers.has(m.homeRosterId) && whisperers.has(m.awayRosterId!))
  if (!pair) return
  const other = matches.find(m => !whisperers.has(m.homeRosterId) && !whisperers.has(m.awayRosterId!))
  if (!other) throw new Error('The fixture needs two non-Whisperer opponents.')
  await prisma.$transaction([
    prisma.redraftMatchup.update({ where: { id: pair.id }, data: { awayRosterId: other.awayRosterId } }),
    prisma.redraftMatchup.update({ where: { id: other.id }, data: { awayRosterId: pair.awayRosterId } }),
  ])
}
/** Actual finalized synthetic player stats feed the native NFL scorer and item-score receipt. */
export async function seedFinalNflFixtureTotals(leagueId: string, seasonId: string, season: number, week: number, targets: Map<string, number>) {
  localOnly()
  const rosterIds = [...targets.keys()]
  const players = await prisma.redraftRosterPlayer.findMany({ where: { rosterId: { in: rosterIds }, droppedAt: null } })
  const lineups = await loadWeekLineups(prisma, { redraftRosterIds: rosterIds, season, week })
  for (const rosterId of rosterIds) {
    const rosterPlayers = players.filter(p => p.rosterId === rosterId)
    const starter = rosterPlayers.find(p => isScoringStarterSlot(weekSlotType(p, lineups)))
    if (!starter) throw new Error('The synthetic roster needs an actual starter.')
    const unit = await calculateScoreFromSportConfig(leagueId, starter.playerId, week, { pass_yd: 1 }, starter.position)
    if (!(unit > 0)) throw new Error('The synthetic NFL stat must have a positive league scoring weight.')
    for (const player of rosterPlayers) {
      const target = player.id === starter.id ? targets.get(rosterId)! : 0
      const stats = { pass_yd: target / unit }
      await prisma.playerWeeklyScore.create({ data: { playerId: player.playerId, sport: 'NFL', season, week, stats, fantasyPts: target, isFinalized: true } })
    }
  }
  await recalculateMatchupsForSeasonWeek(seasonId, week)
  const matches = await prisma.redraftMatchup.findMany({ where: { seasonId, week } })
  for (const match of matches) {
    if (match.status !== 'final' || Math.abs(match.homeScore - targets.get(match.homeRosterId)!) > .01 || Math.abs(match.awayScore - targets.get(match.awayRosterId!)!) > .01) throw new Error('The native synthetic scores did not match the finalized inputs.')
  }
}
