import { prisma } from '@/lib/prisma'
import { getBigBrotherConfig } from './BigBrotherLeagueConfig'
import { buildBigBrotherStandings } from './standings'

export async function getBigBrotherStandings(leagueId: string, userId: string) {
  const config = await getBigBrotherConfig(leagueId)
  if (!config) return null
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } })
  if (!league) return null
  const [rosters, teams, cycles, jury, publishedFinale, scores] = await Promise.all([
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
    prisma.leagueTeam.findMany({ where: { leagueId }, select: { legacyRosterId: true, platformUserId: true, claimedByUserId: true, teamName: true, ownerName: true } }),
    prisma.bigBrotherCycle.findMany({ where: { leagueId, configId: config.configId }, orderBy: { week: 'asc' },
      select: { week: true, phase: true, hohRosterId: true, vetoWinnerRosterId: true, vetoParticipantRosterIds: true, nominee1RosterId: true, nominee2RosterId: true,
        vetoUsed: true, vetoSavedRosterId: true, replacementNomineeRosterId: true, evictedRosterId: true, closedAt: true } }),
    prisma.bigBrotherJuryMember.findMany({ where: { leagueId, configId: config.configId }, select: { rosterId: true } }),
    // FinaleService writes the public result here after tally. Never read individual ballots.
    prisma.bigBrotherAuditLog.findFirst({ where: { leagueId, configId: config.configId, eventType: 'finale_vote' }, orderBy: { createdAt: 'desc' }, select: { metadata: true } }),
    prisma.teamWeekResult.findMany({ where: { leagueId, season: league.season, status: 'final' },
      select: { season: true, rosterId: true, week: true, totalPoints: true } }),
  ])
  const metadata = publishedFinale?.metadata
  const winnerRosterId = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    && typeof metadata.winnerRosterId === 'string' ? metadata.winnerRosterId : null
  const namedRosters = rosters.map(r => {
    // Explicit link first; unique identity fallback only. Never match a team by name or row order.
    const linked = teams.find(t => t.legacyRosterId === r.id)
    const matches = teams.filter(t => t.platformUserId === r.platformUserId || t.claimedByUserId === r.platformUserId)
    const team = linked ?? (matches.length === 1 ? matches[0] : undefined)
    return { id: r.id, teamName: team?.teamName?.trim() || team?.ownerName?.trim() || `Houseguest ${r.id.slice(0, 8)}` }
  })
  const ownedRoster = rosters.find(r => r.platformUserId === userId)
  const claimed = teams.filter(t => t.claimedByUserId === userId)
  const claimedTeam = claimed.length === 1 ? claimed[0] : undefined
  const explicitlyClaimedRoster = claimedTeam ? rosters.find(r => r.id === claimedTeam.legacyRosterId) : undefined
  const identityMatches = claimedTeam ? rosters.filter(r => r.platformUserId === claimedTeam.platformUserId) : []
  const claimedRoster = explicitlyClaimedRoster ?? (identityMatches.length === 1 ? identityMatches[0] : undefined)
  return buildBigBrotherStandings({
    leagueId, season: league.season, rosters: namedRosters,
    cycles: cycles.map(c => ({ ...c, vetoParticipantRosterIds: Array.isArray(c.vetoParticipantRosterIds)
      ? c.vetoParticipantRosterIds.filter((id): id is string => typeof id === 'string') : null })),
    juryRosterIds: jury.map(j => j.rosterId),
    finaleSize: config.finaleFormat === 'final_3' ? 3 : 2, winnerRosterId,
    viewerRosterId: ownedRoster?.id ?? claimedRoster?.id ?? null,
    scores: scores.filter(s => s.season === league.season),
  })
}
