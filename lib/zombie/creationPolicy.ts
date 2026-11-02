/** Shared creation policy: manager count does not control how many scoring periods are played. */
import { getLeagueDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import type { SportType } from '@/lib/sport-defaults/types'

export const ZOMBIE_DEFAULT_MANAGERS = 20
export const ZOMBIE_MIN_MANAGERS = 4
export const ZOMBIE_MAX_UNIVERSE_LEAGUES = 6

export function getZombieCreationProfile(sport: string) {
  const key = sport.toUpperCase() as SportType
  const scoringPeriods = getLeagueDefaults(key).default_regular_season_length
  const suggestedManagers = Math.ceil((scoringPeriods + 2) / 2) * 2
  // Specialty rosters may support more fantasy teams than the professional sport has clubs.
  const maxManagers = key === 'NFL' ? 20 : Math.max(32, suggestedManagers)
  return { scoringPeriods, defaultManagers: ZOMBIE_DEFAULT_MANAGERS, suggestedManagers, minManagers: ZOMBIE_MIN_MANAGERS, maxManagers }
}

export function getZombieCreationTeamCounts(sport: string): number[] {
  const { minManagers, maxManagers } = getZombieCreationProfile(sport)
  return Array.from({ length: (maxManagers - minManagers) / 2 + 1 }, (_, i) => minManagers + i * 2)
}

export function zombieCreationLeagueCount(setup: Record<string, unknown> | null | undefined): number {
  const count = setup?.zombieLeagueCount === undefined ? 1 : setup.zombieLeagueCount
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > ZOMBIE_MAX_UNIVERSE_LEAGUES) {
    throw new Error('Choose between 1 and 6 Zombie leagues.')
  }
  return count
}
