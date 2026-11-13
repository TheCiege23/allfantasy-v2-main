/**
 * PlayoffOddsCalculator
 *
 * Aggregates many simulated standings into playoff probability, first-place
 * probability, expected wins, expected seed, finish range, elimination risk, bye probability.
 */

import type { SimulatedStanding } from './types'

interface PlayoffOddsInput {
  simulationResults: SimulatedStanding[][]
  playoffSpots: number
  byeSpots: number
  teamIds: string[]
}

interface TeamPlayoffOdds {
  teamId: string
  playoffProbability: number
  firstPlaceProbability: number
  expectedWins: number
  expectedFinalSeed: number
  finishRange: { min: number; max: number }
  eliminationRisk: number
  byeProbability: number
}

export function calculatePlayoffOdds(input: PlayoffOddsInput): TeamPlayoffOdds[] {
  const { simulationResults, playoffSpots, byeSpots, teamIds } = input
  const nSim = simulationResults.length
  if (nSim === 0) {
    return teamIds.map((teamId) => ({
      teamId,
      playoffProbability: 0,
      firstPlaceProbability: 0,
      expectedWins: 0,
      expectedFinalSeed: 0,
      finishRange: { min: 0, max: 0 },
      eliminationRisk: 1,
      byeProbability: 0,
    }))
  }

  const playoffCount = new Map<string, number>()
  const firstPlaceCount = new Map<string, number>()
  const byeCount = new Map<string, number>()
  const winsSum = new Map<string, number>()
  const seedSum = new Map<string, number>()
  const seedMin = new Map<string, number>()
  const seedMax = new Map<string, number>()

  for (const tid of teamIds) {
    playoffCount.set(tid, 0)
    firstPlaceCount.set(tid, 0)
    byeCount.set(tid, 0)
    winsSum.set(tid, 0)
    seedSum.set(tid, 0)
    seedMin.set(tid, 999)
    seedMax.set(tid, 0)
  }

  for (const standing of simulationResults) {
    for (const row of standing) {
      const tid = row.teamId
      if (row.seed <= playoffSpots) playoffCount.set(tid, (playoffCount.get(tid) ?? 0) + 1)
      if (row.seed === 1) firstPlaceCount.set(tid, (firstPlaceCount.get(tid) ?? 0) + 1)
      if (row.seed <= byeSpots) byeCount.set(tid, (byeCount.get(tid) ?? 0) + 1)
      winsSum.set(tid, (winsSum.get(tid) ?? 0) + row.wins)
      seedSum.set(tid, (seedSum.get(tid) ?? 0) + row.seed)
      seedMin.set(tid, Math.min(seedMin.get(tid) ?? 999, row.seed))
      seedMax.set(tid, Math.max(seedMax.get(tid) ?? 0, row.seed))
    }
  }

  return teamIds.map((teamId) => {
    const playoffPct = ((playoffCount.get(teamId) ?? 0) / nSim) * 100
    return {
      teamId,
      playoffProbability: Math.round(playoffPct * 10) / 10,
      firstPlaceProbability: Math.round(((firstPlaceCount.get(teamId) ?? 0) / nSim) * 1000) / 10,
      expectedWins: Math.round((winsSum.get(teamId) ?? 0) / nSim * 10) / 10,
      expectedFinalSeed: Math.round((seedSum.get(teamId) ?? 0) / nSim * 10) / 10,
      finishRange: {
        min: seedMin.get(teamId) ?? 0,
        max: seedMax.get(teamId) ?? 0,
      },
      eliminationRisk: Math.round((100 - playoffPct) * 10) / 10,
      byeProbability: Math.round(((byeCount.get(teamId) ?? 0) / nSim) * 1000) / 10,
    }
  })
}
