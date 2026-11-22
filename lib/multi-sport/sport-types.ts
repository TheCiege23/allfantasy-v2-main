/**
 * Canonical sport type used across multi-sport modules.
 * Aligns with LeagueSport enum (NFL, NHL, MLB, NBA, NCAAF, NCAAB).
 */
export type SportType =
  | 'NFL'
  | 'NHL'
  | 'MLB'
  | 'NBA'
  | 'NCAAF'
  | 'NCAAB'
  | 'SOCCER'

export const SPORT_TYPES: SportType[] = [
  'NFL',
  'NHL',
  'MLB',
  'NBA',
  'NCAAF',
  'NCAAB',
  'SOCCER',
]

export const SPORT_DISPLAY_NAMES: Record<SportType, string> = {
  NFL: 'NFL',
  NHL: 'NHL',
  MLB: 'MLB',
  NBA: 'NBA',
  NCAAF: 'NCAA Football',
  NCAAB: 'NCAA Basketball',
  SOCCER: 'Soccer',
}

export const SPORT_EMOJI: Record<SportType, string> = {
  NFL: '🏈',
  NHL: '🏒',
  MLB: '⚾',
  NBA: '🏀',
  NCAAF: '🏈',
  NCAAB: '🏀',
  SOCCER: '⚽',
}

function isSportType(s: string): s is SportType {
  return SPORT_TYPES.includes(s as SportType)
}

export function toSportType(s: string): SportType {
  const u = s?.toUpperCase?.()
  if (u === 'NCAA FOOTBALL' || u === 'NCAAF') return 'NCAAF'
  if (u === 'NCAA BASKETBALL' || u === 'NCAAB') return 'NCAAB'
  if (u === 'SOCCER' || u === 'MLS' || u === 'FPL') return 'SOCCER'
  if (isSportType(u)) return u as SportType
  return 'NFL'
}
