const ITERATION_LIMITS = {
  matchup: { dev: 5000, prod: 2000 },
  season: { dev: 3000, prod: 1000 },
  playoff: { dev: 5000, prod: 1500 },
  championship: { dev: 5000, prod: 2000 },
} as const

function capIterations(requested: number, type: keyof typeof ITERATION_LIMITS): number {
  const isProd = process.env.NODE_ENV === 'production'
  const limit = isProd ? ITERATION_LIMITS[type].prod : ITERATION_LIMITS[type].dev
  return Math.min(requested, limit)
}

function randomNormal(mean: number, stdDev: number): number {
  const u = 1 - Math.random()
  const v = Math.random()
  return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

export interface TeamProjection {
  mean: number
  stdDev: number
  teamId?: string
  name?: string
  seed?: number
}

interface MatchupResult {
  winProbability: number
  marginMean: number
  marginStdDev: number
}

export function simulateMatchup(
  teamA: TeamProjection,
  teamB: TeamProjection,
  iterations = 5000
): MatchupResult {
  iterations = capIterations(iterations, 'matchup')
  let winsA = 0
  let marginSum = 0
  let marginSqSum = 0

  for (let i = 0; i < iterations; i++) {
    const scoreA = randomNormal(teamA.mean, teamA.stdDev)
    const scoreB = randomNormal(teamB.mean, teamB.stdDev)
    const margin = scoreA - scoreB

    if (scoreA > scoreB) winsA++
    marginSum += margin
    marginSqSum += margin * margin
  }

  const marginMean = marginSum / iterations
  const marginVariance = marginSqSum / iterations - marginMean * marginMean
  const marginStdDev = Math.sqrt(Math.max(0, marginVariance))

  return {
    winProbability: Math.round((winsA / iterations) * 1000) / 1000,
    marginMean: Math.round(marginMean * 10) / 10,
    marginStdDev: Math.round(marginStdDev * 10) / 10,
  }
}

interface SeasonSimResult {
  expectedWins: number
  playoffProbability: number
  byeWeekProbability: number
}

export function simulateSeason(
  team: TeamProjection,
  opponents: TeamProjection[],
  playoffSpots: number,
  byeSpots: number,
  iterations = 3000
): SeasonSimResult {
  iterations = capIterations(iterations, 'season')
  let totalWins = 0
  let playoffCount = 0
  let byeCount = 0

  for (let sim = 0; sim < iterations; sim++) {
    let wins = 0
    for (const opp of opponents) {
      const scoreA = randomNormal(team.mean, team.stdDev)
      const scoreB = randomNormal(opp.mean, opp.stdDev)
      if (scoreA > scoreB) wins++
    }

    totalWins += wins

    const winThresholdPlayoff = opponents.length * (1 - playoffSpots / (playoffSpots + 2))
    const winThresholdBye = opponents.length * (1 - byeSpots / (byeSpots + 2))

    if (wins >= winThresholdPlayoff) playoffCount++
    if (wins >= winThresholdBye) byeCount++
  }

  return {
    expectedWins: Math.round((totalWins / iterations) * 10) / 10,
    playoffProbability: Math.round((playoffCount / iterations) * 1000) / 1000,
    byeWeekProbability: Math.round((byeCount / iterations) * 1000) / 1000,
  }
}

interface PlayoffSimResult {
  championshipProbability: number
  finalistProbability: number
}

export function simulatePlayoffs(
  teams: TeamProjection[],
  targetTeamIndex: number,
  iterations = 5000
): PlayoffSimResult {
  iterations = capIterations(iterations, 'playoff')
  if (teams.length < 2) {
    return { championshipProbability: 1, finalistProbability: 1 }
  }

  let championshipWins = 0
  let finalistCount = 0

  for (let sim = 0; sim < iterations; sim++) {
    let bracket = [...teams]

    while (bracket.length > 1) {
      const nextRound: TeamProjection[] = []
      for (let i = 0; i < bracket.length; i += 2) {
        if (i + 1 >= bracket.length) {
          nextRound.push(bracket[i])
          continue
        }
        const scoreA = randomNormal(bracket[i].mean, bracket[i].stdDev)
        const scoreB = randomNormal(bracket[i + 1].mean, bracket[i + 1].stdDev)
        nextRound.push(scoreA >= scoreB ? bracket[i] : bracket[i + 1])
      }

      if (bracket.length === 2) {
        const isTarget = bracket.findIndex(t => t === teams[targetTeamIndex])
        if (isTarget >= 0) finalistCount++
      }

      bracket = nextRound
    }

    if (bracket[0] === teams[targetTeamIndex]) {
      championshipWins++
    }
  }

  return {
    championshipProbability: Math.round((championshipWins / iterations) * 1000) / 1000,
    finalistProbability: Math.round((finalistCount / iterations) * 1000) / 1000,
  }
}

interface ChampionshipDelta {
  oddsBefore: number
  oddsAfter: number
  delta: number
}

export function computeChampionshipDelta(
  teams: TeamProjection[],
  targetTeamIndex: number,
  meanDelta: number,
  stdDevDelta: number = 0,
  iterations = 5000
): ChampionshipDelta {
  iterations = capIterations(iterations, 'championship')
  const before = simulatePlayoffs(teams, targetTeamIndex, iterations)

  const modifiedTeams = teams.map((t, i) => {
    if (i === targetTeamIndex) {
      return {
        ...t,
        mean: t.mean + meanDelta,
        stdDev: Math.max(1, t.stdDev + stdDevDelta),
      }
    }
    return t
  })

  const after = simulatePlayoffs(modifiedTeams, targetTeamIndex, iterations)

  return {
    oddsBefore: before.championshipProbability,
    oddsAfter: after.championshipProbability,
    delta: Math.round((after.championshipProbability - before.championshipProbability) * 1000) / 1000,
  }
}
