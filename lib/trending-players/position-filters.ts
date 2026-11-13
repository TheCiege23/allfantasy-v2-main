import type { SupportedSport } from '@/lib/sport-scope'

/** Position dropdown options per sport (ALL + sport-specific). */
const POSITION_OPTIONS_BY_SPORT: Record<SupportedSport | 'ALL', string[]> = {
  ALL: ['ALL'],
  NFL: ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST', 'IDP'],
  NBA: ['ALL', 'G', 'PG', 'SG', 'SF', 'PF', 'C', 'UTIL'],
  MLB: ['ALL', 'SP', 'RP', 'P', 'C', '1B', '2B', '3B', 'SS', 'OF', 'UTIL'],
  NHL: ['ALL', 'C', 'W', 'LW', 'RW', 'D', 'G'],
  SOCCER: ['ALL', 'F', 'M', 'D', 'GK'],
  NCAAF: ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST', 'FLEX'],
  NCAAB: ['ALL', 'G', 'F', 'C', 'UTIL'],
}

export function positionsForSport(sport: SupportedSport | 'ALL'): string[] {
  return POSITION_OPTIONS_BY_SPORT[sport] ?? ['ALL']
}

export function matchesPositionFilter(playerPos: string, filter: string, sport: SupportedSport | 'ALL'): boolean {
  const f = filter.toUpperCase().trim()
  if (!f || f === 'ALL') return true
  const p = playerPos.toUpperCase().trim()
  if (f === 'FLEX' && sport === 'NFL') {
    return ['RB', 'WR', 'TE'].includes(p)
  }
  if (f === 'UTIL' && (sport === 'NBA' || sport === 'MLB' || sport === 'NCAAB')) {
    return true
  }
  if (f === 'G' && sport === 'NBA') return p === 'PG' || p === 'SG' || p === 'G'
  if (f === 'F' && sport === 'NBA') return p === 'SF' || p === 'PF' || p === 'F'
  if (f === 'W' && sport === 'NHL') return p === 'LW' || p === 'RW' || p === 'W'
  if (f === 'P' && sport === 'MLB') return p === 'SP' || p === 'RP' || p === 'P'
  return p === f || p.startsWith(f)
}
