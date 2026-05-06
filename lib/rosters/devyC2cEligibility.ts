/**
 * Devy vs C2C vs pro — separate from taxi (young pro stash).
 */

import type { PlayerExperienceResult } from '@/lib/player-data/playerExperience'
import type { LeagueSport } from '@prisma/client'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export function isPlayerDevyEligible(
  sport: LeagueSport | string,
  exp: PlayerExperienceResult,
  options?: { hasDevyRights?: boolean },
): boolean {
  const s = normalizeToSupportedSport(sport)
  if (s === 'NCAAF' || s === 'NCAAB') {
    return exp.devyEligible || exp.status === 'college'
  }
  return Boolean(options?.hasDevyRights)
}

export function isPlayerC2cEligible(sport: LeagueSport | string, exp: PlayerExperienceResult): boolean {
  const s = normalizeToSupportedSport(sport)
  return (s === 'NCAAF' || s === 'NCAAB') && exp.c2cEligible
}

export function getDevyEligibilityReason(sport: LeagueSport | string, exp: PlayerExperienceResult): string {
  if (isPlayerDevyEligible(sport, exp)) return 'Eligible as college/devy pool player.'
  return 'Not devy eligible for this player context.'
}
