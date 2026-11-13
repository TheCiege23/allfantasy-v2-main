/**
 * StandingsProjectionCalculator
 *
 * Given current standings, remaining schedule, and team strength (mean/stdDev),
 * runs one simulated season and returns final standings with seeds.
 */

import type { SimulatedStanding } from './types'

function randomNormal(mean: number, stdDev: number): number {
  const u = 1 - Math.random()
  const v = Math.random()
  return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

interface ProjectionInput {
  standings: Map<string, { wins: number; losses: number; ties: number; pointsFor: number }>
  teamProjections: Map<string, { mean: number; stdDev: number }>
  remainingSchedule: Array<[string, string][]>
}

/**
 * Run one full simulation of the remaining schedule.
 * Returns final standings (current + simulated) sorted by wins then pointsFor.
 */
export function runOneSimulation(input: ProjectionInput): SimulatedStanding[] {
  const { standings, teamProjections, remainingSchedule } = input
  const teamIds = Array.from(standings.keys())

  const wins = new Map<string, number>()
  const losses = new Map<string, number>()
  const ties = new Map<string, number>()
  const pointsFor = new Map<string, number>()

  for (const tid of teamIds) {
    const s = standings.get(tid)!
    wins.set(tid, s.wins)
    losses.set(tid, s.losses)
    ties.set(tid, s.ties)
    pointsFor.set(tid, s.pointsFor)
  }

  for (const weekMatchups of remainingSchedule) {
    for (const [tidA, tidB] of weekMatchups) {
      const projA = teamProjections.get(tidA) ?? { mean: 100, stdDev: 15 }
      const projB = teamProjections.get(tidB) ?? { mean: 100, stdDev: 15 }
      const scoreA = Math.max(0, randomNormal(projA.mean, projA.stdDev))
      const scoreB = Math.max(0, randomNormal(projB.mean, projB.stdDev))

      const pfA = pointsFor.get(tidA) ?? 0
      const pfB = pointsFor.get(tidB) ?? 0
      pointsFor.set(tidA, pfA + scoreA)
      pointsFor.set(tidB, pfB + scoreB)

      if (Math.abs(scoreA - scoreB) < 0.01) {
        ties.set(tidA, (ties.get(tidA) ?? 0) + 1)
        ties.set(tidB, (ties.get(tidB) ?? 0) + 1)
      } else if (scoreA > scoreB) {
        wins.set(tidA, (wins.get(tidA) ?? 0) + 1)
        losses.set(tidB, (losses.get(tidB) ?? 0) + 1)
      } else {
        wins.set(tidB, (wins.get(tidB) ?? 0) + 1)
        losses.set(tidA, (losses.get(tidA) ?? 0) + 1)
      }
    }
  }

  const list: SimulatedStanding[] = teamIds.map((teamId) => ({
    teamId,
    wins: wins.get(teamId) ?? 0,
    losses: losses.get(teamId) ?? 0,
    ties: ties.get(teamId) ?? 0,
    pointsFor: pointsFor.get(teamId) ?? 0,
    seed: 0,
  }))

  list.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    return (b.pointsFor ?? 0) - (a.pointsFor ?? 0)
  })
  list.forEach((row, i) => {
    row.seed = i + 1
  })
  return list
}
