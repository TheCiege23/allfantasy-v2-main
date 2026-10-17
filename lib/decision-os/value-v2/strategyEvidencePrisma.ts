import { prisma } from '@/lib/prisma'
import { resolveNormalizedLeagueContext } from '@/lib/league-context-engine/resolveNormalizedLeagueContext'
import type { StrategyEvidencePort } from './strategyEvidence'

export const strategyEvidencePrismaPort: StrategyEvidencePort = {
  async load(scope) {
    const resolved = await resolveNormalizedLeagueContext({ userId: scope.userId, leagueId: scope.leagueId })
    if (!resolved.ok || !resolved.context.team || resolved.context.season !== scope.season ||
      resolved.context.userId !== scope.userId || resolved.context.leagueId !== scope.leagueId) return null
    const context = resolved.context
    const [league, teams] = await Promise.all([
      prisma.league.findUnique({ where: { id: scope.leagueId }, select: { leagueSize: true } }),
      prisma.leagueTeam.findMany({ where: { leagueId: scope.leagueId }, select: { id: true, claimedByUserId: true } }),
    ])
    const owner = teams.find(t => t.id === context.team!.teamId && t.claimedByUserId === scope.userId)
    if (!owner || teams.filter(t => t.claimedByUserId === scope.userId).length !== 1 || !league || teams.length > 64 ||
      context.matchupPeriod.source !== 'sleeper_state_nfl' || context.matchupPeriod.verifiedRegularSeason !== true ||
      context.matchupPeriod.currentPeriod < 4 || context.matchupPeriod.currentPeriod > 18) return null
    const results = await prisma.teamPerformance.findMany({
      where: { teamId: { in: teams.map(t => t.id) }, season: scope.season, week: { gte: 1, lt: context.matchupPeriod.currentPeriod } },
      select: { id: true, teamId: true, season: true, week: true, points: true, result: true }, take: 64 * 18 + 1,
    })
    return { leagueId: scope.leagueId, userId: scope.userId, season: scope.season, sport: context.sport, isDynasty: context.flags.isDynasty,
      teamCount: league.leagueSize, ownerTeamId: owner.id, teamIds: teams.map(t => t.id),
      currentPeriod: context.matchupPeriod.currentPeriod, periodSource: context.matchupPeriod.source,
      loadedAt: new Date().toISOString(), lastSyncedAt: context.importHealth.lastSyncedAt, results }
  },
}
