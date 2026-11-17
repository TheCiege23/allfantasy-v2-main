/**
 * Taxi squad settings engine. PROMPT 3/5.
 * Inherited from Dynasty; effective slot count from Dynasty / Devy / C2C config.
 */

import { prisma } from '@/lib/prisma'
import {
  TAXI_ELIGIBLE_POSITIONS_NFL,
  TAXI_ELIGIBLE_POSITIONS_NBA,
  TAXI_DEFAULT_CORE_DYNASTY,
  TAXI_DEFAULT_DEVY,
  TAXI_DEFAULT_C2C_PRO,
} from './constants'

export interface EffectiveTaxiSettings {
  taxiSlotCount: number
  taxiEligibilityYears: number
  taxiLockBehavior: string
  taxiInSeasonMoves: boolean
  taxiPostseasonMoves: boolean
  taxiScoringOn: boolean
  taxiDeadlineWeek: number | null
  taxiPromotionDeadlineWeek: number | null
}

/**
 * Get taxi-eligible positions for a sport (core dynasty / pro side).
 */
export function getTaxiEligiblePositions(sport: string): readonly string[] {
  const s = String(sport).toUpperCase()
  if (s === 'NFL') return TAXI_ELIGIBLE_POSITIONS_NFL
  if (s === 'NBA') return TAXI_ELIGIBLE_POSITIONS_NBA
  return []
}

/**
 * Check if a position is taxi-eligible for the sport.
 */
export function isTaxiEligiblePosition(sport: string, position: string): boolean {
  const positions = getTaxiEligiblePositions(sport)
  const pos = String(position).toUpperCase()
  return positions.some((p) => p.toUpperCase() === pos)
}

/**
 * Get effective taxi settings for a league (slot count from Devy/C2C override when applicable).
 */
export async function getEffectiveTaxiSettings(leagueId: string): Promise<EffectiveTaxiSettings | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      sport: true,
      leagueVariant: true,
      dynastyConfig: true,
    },
  })
  if (!league) return null

  const variant = String(league.leagueVariant ?? '').toLowerCase()
  const isDevy = variant === 'devy_dynasty'
  const isC2C = variant === 'merged_devy_c2c'

  let taxiSlotCount = league.dynastyConfig?.taxiSlots ?? TAXI_DEFAULT_CORE_DYNASTY
  if (isDevy) {
    const devy = await prisma.devyLeagueConfig.findUnique({
      where: { leagueId },
      select: { taxiSize: true },
    })
    taxiSlotCount = devy?.taxiSize ?? TAXI_DEFAULT_DEVY
  } else if (isC2C) {
    const c2c = await prisma.c2CLeagueConfig.findUnique({
      where: { leagueId },
      select: { taxiSize: true },
    })
    taxiSlotCount = c2c?.taxiSize ?? TAXI_DEFAULT_C2C_PRO
  }

  const d = league.dynastyConfig
  return {
    taxiSlotCount,
    taxiEligibilityYears: d?.taxiEligibilityYears ?? 1,
    taxiLockBehavior: d?.taxiLockBehavior ?? 'once_promoted_no_return',
    taxiInSeasonMoves: d?.taxiInSeasonMoves ?? true,
    taxiPostseasonMoves: d?.taxiPostseasonMoves ?? false,
    taxiScoringOn: d?.taxiScoringOn ?? false,
    taxiDeadlineWeek: d?.taxiDeadlineWeek ?? null,
    taxiPromotionDeadlineWeek: d?.taxiPromotionDeadlineWeek ?? null,
  }
}

/**
 * Validate taxi eligibility by years in league (0 = rookie, 1 = 2nd year, 2 = 3rd year).
 * Returns true if player is within allowed years.
 */
export function isTaxiEligibleByExperience(yearsInLeague: number, eligibilityYears: number): boolean {
  return yearsInLeague >= 0 && yearsInLeague < eligibilityYears
}
