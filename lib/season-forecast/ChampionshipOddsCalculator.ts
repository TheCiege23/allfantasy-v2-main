/**
 * ChampionshipOddsCalculator
 *
 * For each simulated season, takes top playoffSpots teams and runs a single-elimination
 * bracket (by seed), using team strength to determine win probability each round.
 * Aggregates championship win rate per team.
 */

import type { SimulatedStanding } from './types'

function randomNormal(mean: number, stdDev: number): number {
  const u = 1 - Math.random()
  const v = Math.random()
  return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

interface ChampionshipOddsInput {
  simulationResults: SimulatedStanding[][]
  playoffSpots: number
  teamProjections: Map<string, { mean: number; stdDev: number }>
}

/**
 * Simulate one playoff bracket. Teams are ordered by seed (1..playoffSpots).
 * Bracket: 1 vs 8, 4 vs 5, 2 vs 7, 3 vs 6 (for 8 teams), etc.
 */
function runOneBracket(
  playoffTeams: SimulatedStanding[],
  teamProjections: Map<string, { mean: number; stdDev: number }>
): string {
  if (playoffTeams.length === 0) return ''
  if (playoffTeams.length === 1) return playoffTeams[0].teamId

  let bracket = playoffTeams.map((t) => t.teamId)
  while (bracket.length > 1) {
    const next: string[] = []
    for (let i = 0; i < bracket.length; i += 2) {
      if (i + 1 >= bracket.length) {
        next.push(bracket[i])
        continue
      }
      const a = bracket[i]
      const b = bracket[i + 1]
      const projA = teamProjections.get(a) ?? { mean: 100, stdDev: 15 }
      const projB = teamProjections.get(b) ?? { mean: 100, stdDev: 15 }
      const scoreA = randomNormal(projA.mean, projA.stdDev)
      const scoreB = randomNormal(projB.mean, projB.stdDev)
      next.push(scoreA >= scoreB ? a : b)
    }
    bracket = next
  }
  return bracket[0]
}

/**
 * Build bracket order by seed. Standard: 8-team 1v8,4v5,2v7,3v6; 6-team 1v6,3v4,2v5; 4-team 1v4,2v3.
 */
function bracketOrder(playoffTeams: SimulatedStanding[]): SimulatedStanding[] {
  const n = playoffTeams.length
  if (n <= 2) return playoffTeams
  const bySeed = new Map(playoffTeams.map((t) => [t.seed, t]))
  const seedOrder =
    n >= 8 ? [1, 8, 4, 5, 2, 7, 3, 6].slice(0, n)
    : n === 6 ? [1, 6, 3, 4, 2, 5]
    : n === 4 ? [1, 4, 2, 3]
    : Array.from({ length: n }, (_, i) => i + 1)
  const ordered: SimulatedStanding[] = []
  for (const seed of seedOrder) {
    const t = bySeed.get(seed)
    if (t) ordered.push(t)
  }
  return ordered.length ? ordered : playoffTeams
}

export function calculateChampionshipOdds(input: ChampionshipOddsInput): Map<string, number> {
  const { simulationResults, playoffSpots, teamProjections } = input
  const champCount = new Map<string, number>()
  const nSim = simulationResults.length
  if (nSim === 0) return champCount

  for (const standing of simulationResults) {
    const playoffTeams = standing.filter((r) => r.seed <= playoffSpots)
    const ordered = bracketOrder(playoffTeams)
    const winner = runOneBracket(ordered, teamProjections)
    if (winner) champCount.set(winner, (champCount.get(winner) ?? 0) + 1)
  }

  return champCount
}
