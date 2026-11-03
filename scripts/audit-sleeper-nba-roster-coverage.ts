/**
 * Read-only Sleeper NBA roster coverage using the same grader as My Team.
 * Run with a read-only database connection:
 * npx tsx --conditions=react-server scripts/audit-sleeper-nba-roster-coverage.ts <leagueId>
 */
import { getRosterGrade, type NbaRosterCoverage } from '@/lib/core-app/rosterGrade'
import { prisma } from '@/lib/prisma'

async function main(leagueId: string | undefined) {
  if (!leagueId?.trim()) throw new Error('Pass an AllFantasy league ID.')
  const [mode] = await prisma.$queryRaw<Array<{ mode: string }>>`
    SELECT current_setting('default_transaction_read_only') AS mode
  `
  if (mode?.mode !== 'on') throw new Error('Use a database connection with default_transaction_read_only=on.')

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, sport: true, platform: true, isDynasty: true },
  })
  if (!league || league.sport?.toUpperCase() !== 'NBA' || league.platform?.toLowerCase() !== 'sleeper') {
    throw new Error('Expected a Sleeper NBA league.')
  }

  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    orderBy: { id: 'asc' },
    select: { platformUserId: true },
  })
  const audit: { report?: NbaRosterCoverage } = {}
  await getRosterGrade({
    leagueId,
    isDynasty: Boolean(league.isDynasty),
    myPlatformUserIds: rosters.map((roster) => roster.platformUserId),
    starters: [],
    onNbaCoverage: (coverage) => { audit.report = coverage },
  })
  const { report } = audit
  if (!report) throw new Error('The grader did not reach the coverage check. Check the stored rosters.')

  const missingIds = [...new Set(report.teams.flatMap((team) => team.missing.map((player) => player.playerId)))]
  const names = new Map((await prisma.sportsPlayer.findMany({
    where: { sport: 'NBA', source: 'sleeper', sleeperId: { in: missingIds } },
    select: { sleeperId: true, name: true },
  })).map((player) => [player.sleeperId, player.name]))
  const teams = report.teams.map((team) => ({
    ...team,
    passes: team.qualified >= team.required,
    missing: team.missing.map((player) => ({ ...player, name: names.get(player.playerId) ?? null })),
  }))
  const allTeamsPass = rosters.length === teams.length && !report.modelUnavailableReason && teams.every((team) => team.passes)
  console.log(JSON.stringify({
    league: league.name,
    threshold: report.threshold,
    storedRosters: rosters.length,
    evaluatedRosters: teams.length,
    allTeamsPass,
    modelUnavailableReason: report.modelUnavailableReason,
    teams,
  }, null, 2))
  if (!allTeamsPass) process.exitCode = 2
}

main(process.argv[2]).catch((error: unknown) => {
  // Avoid printing a connection string from database/client errors.
  console.error(error instanceof Error && !('clientVersion' in error) ? error.message : 'Database audit failed.')
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
