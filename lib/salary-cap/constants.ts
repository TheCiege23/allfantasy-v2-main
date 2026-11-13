/**
 * Salary Cap League — sport-aware defaults and constants (PROMPT 339).
 * Align with lib/sport-scope.ts and PROMPT 337 product spec.
 */

import type { LeagueSport } from '@prisma/client'

export const SALARY_CAP_VARIANT = 'salary_cap'

/** Default startup cap by sport. */
export const DEFAULT_STARTUP_CAP_BY_SPORT: Partial<Record<LeagueSport, number>> = {
  NFL: 250,
  NHL: 250,
  NBA: 250,
  MLB: 250,
  NCAAB: 200,
  NCAAF: 200,
  SOCCER: 200,
}

/** Default cap growth % (NCAAB/NCAAF often 0). */
export const DEFAULT_CAP_GROWTH_BY_SPORT: Partial<Record<LeagueSport, number>> = {
  NFL: 5,
  NHL: 5,
  NBA: 5,
  MLB: 5,
  NCAAB: 0,
  NCAAF: 0,
  SOCCER: 5,
}

/** Default contract max years (college shorter). */
export const DEFAULT_CONTRACT_MAX_YEARS_BY_SPORT: Partial<Record<LeagueSport, number>> = {
  NFL: 4,
  NHL: 4,
  NBA: 4,
  MLB: 4,
  NCAAB: 3,
  NCAAF: 3,
  SOCCER: 4,
}

/** Default rookie contract years. */
export const DEFAULT_ROOKIE_CONTRACT_YEARS_BY_SPORT: Partial<Record<LeagueSport, number>> = {
  NFL: 3,
  NHL: 3,
  NBA: 3,
  MLB: 3,
  NCAAB: 2,
  NCAAF: 2,
  SOCCER: 3,
}

/** Default rollover max (0 for college). */
export const DEFAULT_ROLLOVER_MAX_BY_SPORT: Partial<Record<LeagueSport, number>> = {
  NFL: 25,
  NHL: 25,
  NBA: 25,
  MLB: 25,
  NCAAB: 0,
  NCAAF: 0,
  SOCCER: 25,
}

export const DEFAULT_STARTUP_CAP = 250
export const DEFAULT_CAP_GROWTH_PERCENT = 5
export const DEFAULT_CONTRACT_MIN_YEARS = 1
export const DEFAULT_CONTRACT_MAX_YEARS = 4
export const DEFAULT_ROOKIE_CONTRACT_YEARS = 3
export const DEFAULT_MINIMUM_SALARY = 1
export const DEFAULT_DEAD_MONEY_PERCENT = 25
export const DEFAULT_ROLLOVER_MAX = 25
export const DEFAULT_AUCTION_HOLDBACK = 50

