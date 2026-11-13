/**
 * Normalize string to SportType (shared with multi-sport when needed).
 */
import type { SportType } from './types'
import { SPORT_TYPES } from './types'

export function toSportType(s: string): SportType {
  const u = s?.toUpperCase?.()
  if (u === 'NCAA FOOTBALL' || u === 'NCAAF') return 'NCAAF'
  if (u === 'NCAA BASKETBALL' || u === 'NCAAB') return 'NCAAB'
  if (u === 'SOCCER' || u === 'MLS' || u === 'FPL') return 'SOCCER'
  if (SPORT_TYPES.includes(u as SportType)) return u as SportType
  return 'NFL'
}

