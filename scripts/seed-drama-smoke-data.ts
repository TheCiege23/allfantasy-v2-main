import { prisma } from '../lib/prisma'
import { SUPPORTED_SPORTS } from '../lib/sport-scope'
import { assertSafeSeedTarget } from './_assert-safe-seed-target'

type TeamSeed = {
  externalId: string
  ownerName: string
  teamName: string
}

const nowYear = new Date().getUTCFullYear()
const currentSeason = nowYear
const previousSeason = nowYear - 1

function buildTeams(sport: string): TeamSeed[] {
  return [
    {
      externalId: `${sport}_TEAM_ALPHA`,
      ownerName: `${sport}_MANAGER_ALPHA`,
      teamName: `${sport} Alpha`,
    },
    {
      externalId: `${sport}_TEAM_BRAVO`,
      ownerName: `${sport}_MANAGER_BRAVO`,
      teamName: `${sport} Bravo`,
    },
    {
      externalId: `${sport}_TEAM_CHARLIE`,
      ownerName: `${sport}_MANAGER_CHARLIE`,
      teamName: `${sport} Charlie`,
    },
    {
      externalId: `${sport}_TEAM_DELTA`,
      ownerName: `${sport}_MANAGER_DELTA`,
      teamName: `${sport} Delta`,
    },
  ]
}

async function ensureLeagueForSport(userId: string, sport: string): Promise<string> {
  const platform = 'drama-smoke'
  const platformLeagueId = `drama-smoke-${sport.toLowerCase()}`
  const existing = await prisma.league.findFirst({
    where: {
      userId,
      platform,
      platformLeagueId,
    },
    select: { id: true },
  })

  if (existing) {
    await prisma.league.update({
      where: { id: existing.id },
      data: {
        name: `Drama Smoke ${sport}`,
        sport: sport as never,
        season: currentSeason,
        status: 'active',
        leagueSize: 4,
      },
    })
    return existing.id
  }

  const created = await prisma.league.create({
    data: {
      userId,
      platform,
      platformLeagueId,
      name: `Drama Smoke ${sport}`,
      sport: sport as never,
      season: currentSeason,
      status: 'active',
      leagueSize: 4,
      isDynasty: true,
      rosterSize: 16,
    },
    select: { id: true },
  })
  return created.id
}

async function seedSport(userId: string, sport: string): Promise<{
  sport: string
  leagueId: string
  teams: number
  matchups: number
  seasonResults: number
}> {
  const leagueId = await ensureLeagueForSport(userId, sport)
  const teams = buildTeams(sport)

  for (const team of teams) {
    const existing = await prisma.leagueTeam.findFirst({
      where: { leagueId, externalId: team.externalId },
      select: { id: true },
    })
    if (existing) {
      await prisma.leagueTeam.update({
        where: { id: existing.id },
        data: {
          ownerName: team.ownerName,
          teamName: team.teamName,
          wins: 0,
          losses: 0,
          ties: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        },
      })
    } else {
      await prisma.leagueTeam.create({
        data: {
          leagueId,
          externalId: team.externalId,
          ownerName: team.ownerName,
          teamName: team.teamName,
        },
      })
    }
  }

  await prisma.matchupFact.deleteMany({
    where: {
      leagueId,
      sport,
      season: currentSeason,
    },
  })

  await prisma.seasonResult.deleteMany({
    where: {
      leagueId,
      season: { in: [String(currentSeason), String(previousSeason)] },
      rosterId: { in: teams.map((t) => t.externalId) },
    },
  })

  await prisma.seasonSimulationResult.deleteMany({
    where: {
      leagueId,
      sport,
      season: currentSeason,
    },
  })

  await prisma.dynastyProjection.deleteMany({
    where: {
      leagueId,
      sport,
      teamId: { in: teams.map((t) => t.externalId) },
    },
  })

  const [alpha, bravo, charlie, delta] = teams

  await prisma.seasonResult.createMany({
    data: [
      {
        leagueId,
        season: String(currentSeason),
        rosterId: alpha.externalId,
        wins: 2,
        losses: 8,
        champion: false,
      },
      {
        leagueId,
        season: String(currentSeason),
        rosterId: bravo.externalId,
        wins: 8,
        losses: 2,
        champion: false,
      },
      {
        leagueId,
        season: String(currentSeason),
        rosterId: charlie.externalId,
        wins: 7,
        losses: 3,
        champion: false,
      },
      {
        leagueId,
        season: String(currentSeason),
        rosterId: delta.externalId,
        wins: 3,
        losses: 7,
        champion: false,
      },
      {
        leagueId,
        season: String(previousSeason),
        rosterId: bravo.externalId,
        wins: 10,
        losses: 1,
        champion: true,
      },
    ],
  })

  await prisma.matchupFact.createMany({
    data: [
      {
        leagueId,
        sport,
        season: currentSeason,
        weekOrPeriod: 12,
        teamA: charlie.externalId,
        teamB: delta.externalId,
        scoreA: 121.8,
        scoreB: 96.2,
        winnerTeamId: charlie.externalId,
      },
      {
        leagueId,
        sport,
        season: currentSeason,
        weekOrPeriod: 11,
        teamA: charlie.externalId,
        teamB: delta.externalId,
        scoreA: 118.4,
        scoreB: 101.6,
        winnerTeamId: charlie.externalId,
      },
      {
        leagueId,
        sport,
        season: currentSeason,
        weekOrPeriod: 10,
        teamA: charlie.externalId,
        teamB: delta.externalId,
        scoreA: 112.9,
        scoreB: 99.1,
        winnerTeamId: charlie.externalId,
      },
      {
        leagueId,
        sport,
        season: currentSeason,
        weekOrPeriod: 9,
        teamA: alpha.externalId,
        teamB: bravo.externalId,
        scoreA: 103.0,
        scoreB: 112.5,
        winnerTeamId: bravo.externalId,
      },
      {
        leagueId,
        sport,
        season: currentSeason,
        weekOrPeriod: 8,
        teamA: alpha.externalId,
        teamB: bravo.externalId,
        scoreA: 109.8,
        scoreB: 107.9,
        winnerTeamId: alpha.externalId,
      },
    ],
  })

  await prisma.seasonSimulationResult.createMany({
    data: [
      {
        sport,
        leagueId,
        teamId: alpha.externalId,
        season: currentSeason,
        weekOrPeriod: 11,
        playoffProbability: 0.52,
        championshipProbability: 0.09,
        expectedWins: 6.4,
        expectedRank: 3.2,
        simulationsRun: 2000,
      },
      {
        sport,
        leagueId,
        teamId: bravo.externalId,
        season: currentSeason,
        weekOrPeriod: 11,
        playoffProbability: 0.64,
        championshipProbability: 0.19,
        expectedWins: 8.6,
        expectedRank: 1.8,
        simulationsRun: 2000,
      },
      {
        sport,
        leagueId,
        teamId: charlie.externalId,
        season: currentSeason,
        weekOrPeriod: 11,
        playoffProbability: 0.58,
        championshipProbability: 0.17,
        expectedWins: 7.9,
        expectedRank: 2.1,
        simulationsRun: 2000,
      },
      {
        sport,
        leagueId,
        teamId: delta.externalId,
        season: currentSeason,
        weekOrPeriod: 11,
        playoffProbability: 0.41,
        championshipProbability: 0.06,
        expectedWins: 5.8,
        expectedRank: 3.9,
        simulationsRun: 2000,
      },
      {
        sport,
        leagueId,
        teamId: alpha.externalId,
        season: currentSeason,
        weekOrPeriod: 12,
        playoffProbability: 0.39,
        championshipProbability: 0.07,
        expectedWins: 6.1,
        expectedRank: 3.5,
        simulationsRun: 2000,
      },
      {
        sport,
        leagueId,
        teamId: bravo.externalId,
        season: currentSeason,
        weekOrPeriod: 12,
        playoffProbability: 0.47,
        championshipProbability: 0.14,
        expectedWins: 7.6,
        expectedRank: 2.6,
        simulationsRun: 2000,
      },
      {
        sport,
        leagueId,
        teamId: charlie.externalId,
        season: currentSeason,
        weekOrPeriod: 12,
        playoffProbability: 0.66,
        championshipProbability: 0.21,
        expectedWins: 8.3,
        expectedRank: 1.7,
        simulationsRun: 2000,
      },
      {
        sport,
        leagueId,
        teamId: delta.externalId,
        season: currentSeason,
        weekOrPeriod: 12,
        playoffProbability: 0.35,
        championshipProbability: 0.04,
        expectedWins: 5.1,
        expectedRank: 4.1,
        simulationsRun: 2000,
      },
    ],
  })

  await prisma.dynastyProjection.createMany({
    data: [
      {
        leagueId,
        sport,
        teamId: charlie.externalId,
        championshipWindowScore: 82,
        rebuildProbability: 0.16,
        rosterStrength3Year: 78,
        rosterStrength5Year: 75,
        agingRiskScore: 33,
        futureAssetScore: 71,
        season: currentSeason,
      },
      {
        leagueId,
        sport,
        teamId: bravo.externalId,
        championshipWindowScore: 74,
        rebuildProbability: 0.22,
        rosterStrength3Year: 73,
        rosterStrength5Year: 69,
        agingRiskScore: 41,
        futureAssetScore: 66,
        season: currentSeason,
      },
      {
        leagueId,
        sport,
        teamId: alpha.externalId,
        championshipWindowScore: 58,
        rebuildProbability: 0.39,
        rosterStrength3Year: 61,
        rosterStrength5Year: 64,
        agingRiskScore: 47,
        futureAssetScore: 72,
        season: currentSeason,
      },
    ],
  })

  return {
    sport,
    leagueId,
    teams: teams.length,
    matchups: 5,
    seasonResults: 5,
  }
}

async function main(): Promise<void> {
  // Fail closed before the first write — see scripts/_assert-safe-seed-target.ts.
  assertSafeSeedTarget('seed-drama-smoke-data')

  const user = await prisma.appUser.findFirst({
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!user) {
    throw new Error('No AppUser found to attach smoke leagues.')
  }

  const seeded = []
  for (const sport of SUPPORTED_SPORTS) {
    seeded.push(await seedSport(user.id, sport))
  }

  console.log(
    JSON.stringify(
      {
        userId: user.id,
        userEmail: user.email,
        currentSeason,
        previousSeason,
        seeded,
      },
      null,
      2
    )
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
