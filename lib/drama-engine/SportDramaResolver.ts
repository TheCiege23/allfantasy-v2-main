/**
 * SportDramaResolver — sport-aware normalization for the League Drama Engine.
 */

import type { DramaSport } from './types'
import { isSupportedSport } from '@/lib/sport-scope'

const MAP: Record<string, DramaSport> = {
  NFL: 'NFL',
  NHL: 'NHL',
  NBA: 'NBA',
  MLB: 'MLB',
  NCAAB: 'NCAAB',
  'NCAA BASKETBALL': 'NCAAB',
  NCAAF: 'NCAAF',
  'NCAA FOOTBALL': 'NCAAF',
  SOCCER: 'SOCCER',
}

export function normalizeSportForDrama(sport: string | null | undefined): DramaSport | null {
  const u = (sport ?? '').toString().trim().toUpperCase()
  if (!u) return null
  const canonical = MAP[u] ?? u
  return isSupportedSport(canonical) ? canonical : null
}

export function getDramaSportLabel(sport: string | null | undefined): string {
  const s = normalizeSportForDrama(sport)
  if (!s) return 'Unknown'
  const labels: Record<DramaSport, string> = {
    NFL: 'NFL',
    NHL: 'NHL',
    NBA: 'NBA',
    MLB: 'MLB',
    NCAAB: 'NCAA Basketball',
    NCAAF: 'NCAA Football',
    SOCCER: 'Soccer',
  }
  return labels[s]
}

export function isSupportedDramaSport(sport: string | null | undefined): boolean {
  return normalizeSportForDrama(sport) != null
}

export function getDramaCadenceConfig(sport: DramaSport): {
  regularSeasonLength: number
  playoffStartWeek: number
  upsetScoreMultiplier: number
} {
  switch (sport) {
    case 'NFL':
      return { regularSeasonLength: 14, playoffStartWeek: 15, upsetScoreMultiplier: 1.1 }
    case 'NHL':
      return { regularSeasonLength: 24, playoffStartWeek: 25, upsetScoreMultiplier: 1.0 }
    case 'NBA':
      return { regularSeasonLength: 22, playoffStartWeek: 23, upsetScoreMultiplier: 1.0 }
    case 'MLB':
      return { regularSeasonLength: 24, playoffStartWeek: 25, upsetScoreMultiplier: 0.95 }
    case 'NCAAB':
      return { regularSeasonLength: 18, playoffStartWeek: 19, upsetScoreMultiplier: 1.15 }
    case 'NCAAF':
      return { regularSeasonLength: 13, playoffStartWeek: 14, upsetScoreMultiplier: 1.15 }
    case 'SOCCER':
      return { regularSeasonLength: 30, playoffStartWeek: 31, upsetScoreMultiplier: 0.9 }
  }
}

