/**
 * Staging-only, READ-ONLY: what the trade screens would list as future picks for
 * one Fantrax league already committed into the app. Makes no Fantrax request
 * and writes nothing.
 *
 *   node --env-file=.env.staging --require ./scripts/_audit-preload.cjs --import tsx \
 *     scripts/audits/verify-fantrax-trade-screen-picks-staging.ts <fantrax-league-id> [team name ...]
 *
 * Team names after the id are matched loosely and have their picks printed in full.
 */
import { prisma } from '@/lib/prisma'
import { loadImportedFuturePicks } from '@/lib/league-trade-engine/importedFuturePicks'
import targetGuard from '../db-target-identity.cjs'

async function main() {
  const sourceLeagueId = process.argv[2]
  const wanted = process.argv.slice(3).map((s) => s.toLowerCase())
  if (!/^[a-z0-9]{16}$/.test(sourceLeagueId ?? '')) throw new Error('INVALID_LEAGUE_ID')
  if (targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label !== 'staging') {
    throw new Error('STAGING_DATABASE_REQUIRED')
  }

  const league = await prisma.league.findFirst({
    where: { platform: 'fantrax', platformLeagueId: sourceLeagueId },
    select: { id: true, name: true, platform: true, season: true, isDynasty: true, settings: true },
  })
  if (!league) throw new Error('LEAGUE_NOT_COMMITTED')

  const [teams, rosters] = await Promise.all([
    prisma.leagueTeam.findMany({
      where: { leagueId: league.id },
      select: { id: true, externalId: true, platformUserId: true, claimedByUserId: true, teamName: true },
    }),
    prisma.roster.findMany({
      where: { leagueId: league.id },
      select: { id: true, platformUserId: true, playerData: true },
    }),
  ])
  const settings = league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
    ? (league.settings as Record<string, unknown>)
    : null

  const out = await loadImportedFuturePicks({
    leagueId: league.id,
    platform: league.platform,
    isDynasty: Boolean(league.isDynasty),
    leagueSeason: league.season,
    status: typeof settings?.status === 'string' ? settings.status : null,
    teams: teams.map((t) => ({
      id: t.id,
      externalId: String(t.externalId ?? ''),
      platformUserId: t.platformUserId ?? null,
      claimedByUserId: t.claimedByUserId ?? null,
      teamName: t.teamName ?? null,
    })),
    rosters,
  })

  const teamNameByRoster = new Map<string, string>()
  const nameByExternal = new Map(teams.map((t) => [String(t.externalId), t.teamName]))
  for (const [externalId, rosterId] of out.rosterIdByTeamId) {
    teamNameByRoster.set(rosterId, nameByExternal.get(externalId) ?? externalId)
  }
  const counts = [...out.picksByRosterId.entries()].map(([rosterId, picks]) => ({
    team: teamNameByRoster.get(rosterId) ?? rosterId,
    picks: picks.length,
    acquired: picks.filter((p) => p.fromTeamName).length,
  }))
  const all = [...out.picksByRosterId.values()].flat()

  console.log(JSON.stringify({
    target: 'staging',
    league: { name: league.name, season: league.season, teams: teams.length, rosters: rosters.length },
    coverage: out.coverage,
    readFailed: out.readFailed,
    rostersWithPicks: out.picksByRosterId.size,
    totalPicks: all.length,
    seasons: [...new Set(all.map((p) => p.season))].sort(),
    rounds: [...new Set(all.map((p) => p.round))].sort(),
    acquiredPicks: all.filter((p) => p.fromTeamName).length,
    picksPerTeam: { min: Math.min(...counts.map((c) => c.picks)), max: Math.max(...counts.map((c) => c.picks)) },
    teamsNotAtTwelve: counts.filter((c) => c.picks !== 12),
    detail: counts
      .filter((c) => wanted.some((w) => c.team.toLowerCase().includes(w)))
      .map((c) => {
        const rosterId = [...teamNameByRoster.entries()].find(([, name]) => name === c.team)?.[0] ?? ''
        return {
          team: c.team,
          picks: (out.picksByRosterId.get(rosterId) ?? []).map((p) =>
            `${p.season} R${p.round}${p.fromTeamName ? ` (from ${p.fromTeamName})` : ''}`),
        }
      }),
  }, null, 1))
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ failed: true, message: error instanceof Error ? error.message : String(error) }))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
