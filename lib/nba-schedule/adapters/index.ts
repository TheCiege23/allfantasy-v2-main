/**
 * [NEW] lib/nba-schedule/adapters/index.ts
 * Factory: maps LeagueFormatId to the appropriate schedule adapter.
 */

import type { LeagueScheduleAdapter } from '../types'
import { StandardScheduleAdapter } from './StandardScheduleAdapter'
import { GuillotineScheduleAdapter } from './GuillotineScheduleAdapter'
import { SurvivorScheduleAdapter } from './SurvivorScheduleAdapter'
import { ZombieScheduleAdapter } from './ZombieScheduleAdapter'
import { BigBrotherScheduleAdapter } from './BigBrotherScheduleAdapter'
import { TournamentScheduleAdapter } from './TournamentScheduleAdapter'
import { C2CScheduleAdapter } from './C2CScheduleAdapter'

const standardAdapter = new StandardScheduleAdapter()
const guillotineAdapter = new GuillotineScheduleAdapter()
const survivorAdapter = new SurvivorScheduleAdapter()
const zombieAdapter = new ZombieScheduleAdapter()
const bigBrotherAdapter = new BigBrotherScheduleAdapter()
const tournamentAdapter = new TournamentScheduleAdapter()
const c2cAdapter = new C2CScheduleAdapter()

const ADAPTER_MAP: Record<string, LeagueScheduleAdapter> = {
  // Standard formats
  redraft: standardAdapter,
  dynasty: standardAdapter,
  keeper: standardAdapter,
  best_ball: standardAdapter,
  salary_cap: standardAdapter,

  // Specialty formats
  guillotine: guillotineAdapter,
  survivor: survivorAdapter,
  zombie: zombieAdapter,
  big_brother: bigBrotherAdapter,
  tournament: tournamentAdapter,
  c2c: c2cAdapter,

  // Dynasty variants that use standard scheduling
  devy: standardAdapter,
}

/**
 * Get the schedule adapter for a league format.
 * Returns StandardScheduleAdapter for unknown formats.
 */
export function getScheduleAdapter(formatId: string): LeagueScheduleAdapter {
  return ADAPTER_MAP[formatId] ?? standardAdapter
}

export { StandardScheduleAdapter } from './StandardScheduleAdapter'
export { GuillotineScheduleAdapter } from './GuillotineScheduleAdapter'
export { SurvivorScheduleAdapter } from './SurvivorScheduleAdapter'
export { ZombieScheduleAdapter } from './ZombieScheduleAdapter'
export { BigBrotherScheduleAdapter } from './BigBrotherScheduleAdapter'
export { TournamentScheduleAdapter } from './TournamentScheduleAdapter'
export { C2CScheduleAdapter } from './C2CScheduleAdapter'
