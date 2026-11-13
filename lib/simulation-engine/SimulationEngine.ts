/**
 * SimulationEngine — orchestrator for matchup, season, and score-distribution simulations.
 * Single entry for AI matchup predictions, playoff odds, and dashboard cards.
 */

import { runSeasonSimulation } from './SeasonSimulator'
import type { SeasonSimulationInput, SeasonSimulationOutput } from './types'

export { calculatePlayoffOdds } from '@/lib/season-forecast/PlayoffOddsCalculator'
export type { TeamPlayoffOdds } from '@/lib/season-forecast/PlayoffOddsCalculator'

/**
 * Run full season simulation (playoff/championship odds, expected wins/rank).
 */
export async function runSeason(
  input: SeasonSimulationInput,
  options?: { persist?: boolean }
): Promise<SeasonSimulationOutput | null> {
  return runSeasonSimulation(input, options)
}

