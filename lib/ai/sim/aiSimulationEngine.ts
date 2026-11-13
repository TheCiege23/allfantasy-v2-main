/**
 * AllFantasy AI Simulation Engine — Monte Carlo + blended stochastic player model.
 * Safe to import from API routes and (tree-shaken) client bundles.
 */

import { simulateDraft, simulateNextPicks } from '@/lib/ai/sim/draftSimulator'
import { simulateMatchup } from '@/lib/ai/sim/matchupSimulator'
import { rosterStrengthIndex } from '@/lib/ai/sim/playerModel'
import { simulateSeason } from '@/lib/ai/sim/seasonSimulator'
import { simulateTrade } from '@/lib/ai/sim/tradeSimulator'
import type {
  FranchiseSimResult,
  MatchupSimResult,
  MonteCarloOptions,
  SeasonSimResult,
  SimPlayerInput,
  SimTeamInput,
  TradeSimResult,
  WaiverSimResult,
} from '@/lib/ai/sim/types'
import type { DraftSimResult } from '@/lib/ai/sim/types'

export { simulateDraft, simulateNextPicks } from '@/lib/ai/sim/draftSimulator'
export { simulateMatchup } from '@/lib/ai/sim/matchupSimulator'
export { simulateSeason } from '@/lib/ai/sim/seasonSimulator'
export { simulateTrade } from '@/lib/ai/sim/tradeSimulator'
export * from '@/lib/ai/sim/playerModel'
export * from '@/lib/ai/sim/types'

function synthOpponents(count: number, weeklyProj: number, seed: number): SimTeamInput[] {
  const out: SimTeamInput[] = []
  for (let i = 0; i < count; i++) {
    const roster: SimPlayerInput[] = Array.from({ length: 9 }, (_, j) => ({
      id: `s-${seed}-${i}-${j}`,
      position: 'FLEX',
      projection: weeklyProj * (0.9 + (j % 6) * 0.02),
      variance: 7,
      consistency: 0.42,
    }))
    out.push({ id: `opp-${seed}-${i}`, roster })
  }
  return out
}

export function simulateWaiver(args: {
  roster: SimPlayerInput[]
  dropPlayerId: string
  addPlayer: SimPlayerInput
  numTeams: number
  iterations?: number
  weeksRemaining?: number
}): WaiverSimResult {
  const next = args.roster.filter((p) => p.id !== args.dropPlayerId)
  const merged = [...next, args.addPlayer]
  const t = simulateTrade({
    teams: [{ id: 'user', roster: args.roster }],
    beforePlayers: args.roster,
    afterPlayers: merged,
    focusedTeamId: 'user',
    leagueSize: args.numTeams,
    iterations: args.iterations ?? 160,
    weeksRemaining: args.weeksRemaining ?? 12,
  })
  return {
    rosterStrengthDelta: rosterStrengthIndex(merged) - rosterStrengthIndex(args.roster),
    playoffOddsDelta: t.playoffDelta['user'] ?? 0,
    championshipOddsDelta: t.championshipDelta['user'] ?? 0,
    iterations: t.iterations,
  }
}

export function simulateFranchise(args: {
  roster: SimPlayerInput[]
  years: number
  numTeams: number
  iterations?: number
}): FranchiseSimResult {
  const years = Math.max(1, Math.min(8, args.years))
  const it = Math.max(40, Math.min(400, args.iterations ?? 120))
  const nTeams = Math.max(4, Math.min(32, args.numTeams))
  const meanProj =
    args.roster.length > 0
      ? args.roster.reduce((s, p) => s + p.projection, 0) / args.roster.length
      : 8

  const rows: FranchiseSimResult['years'] = []
  let projected = [...args.roster]

  for (let y = 1; y <= years; y++) {
    projected = projected.map((p) => {
      const ageDecay = p.position === 'RB' || p.position === 'WR' ? 0.035 : 0.025
      return {
        ...p,
        projection: Math.max(0.5, p.projection * (1 - ageDecay * y)),
        variance: (p.variance ?? 6) * (1 + 0.02 * y),
      }
    })

    const user: SimTeamInput = { id: 'user', name: 'You', roster: projected }
    const opp = synthOpponents(nTeams - 1, meanProj * (1 - 0.02 * y), y * 17)
    const s = simulateSeason([user, ...opp], {
      iterations: it,
      seed: 400 + y * 17,
      weeksRemaining: 12,
      playoffTeams: Math.min(6, nTeams),
      regularSeasonWeeks: 12,
    })

    rows.push({
      year: y,
      projectedStrength: rosterStrengthIndex(projected),
      playoffOdds: s.playoffOdds['user'] ?? 0,
      championshipOdds: s.championshipOdds['user'] ?? 0,
    })
  }

  return { years: rows, iterations: it }
}

/** Follow vs ignore AI suggestion: compare roster with recommendation applied vs not. */
export function simulateAdviceVsIgnore(args: {
  baselineRoster: SimPlayerInput[]
  /** Roster if user follows AI (e.g. start sit change, waiver add). */
  followRoster: SimPlayerInput[]
  numTeams: number
  iterations?: number
}): {
  follow: SeasonSimResult
  ignore: SeasonSimResult
  deltaPlayoff: number
  deltaChampionship: number
} {
  const mc: MonteCarloOptions = {
    iterations: args.iterations ?? 150,
    seed: 51,
    weeksRemaining: 12,
    playoffTeams: 6,
    regularSeasonWeeks: 12,
  }
  const mean =
    args.baselineRoster.reduce((s, p) => s + p.projection, 0) / Math.max(1, args.baselineRoster.length)
  const opp = synthOpponents(args.numTeams - 1, mean * 0.97, 3)
  const follow = simulateSeason([{ id: 'user', roster: args.followRoster }, ...opp], mc)
  const ignore = simulateSeason([{ id: 'user', roster: args.baselineRoster }, ...opp], { ...mc, seed: 52 })
  return {
    follow,
    ignore,
    deltaPlayoff: (follow.playoffOdds['user'] ?? 0) - (ignore.playoffOdds['user'] ?? 0),
    deltaChampionship: (follow.championshipOdds['user'] ?? 0) - (ignore.championshipOdds['user'] ?? 0),
  }
}
