/**
 * SportRivalryResolver — sport-aware normalization for the Rivalry Engine.
 * Supports NFL, NHL, NBA, MLB, NCAA Basketball, NCAA Football, Soccer.
 */

import type { RivalrySport } from './types'
import { isSupportedSport } from '@/lib/sport-scope'

const MAP: Record<string, RivalrySport> = {
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

export function normalizeSportForRivalry(sport: string | null | undefined): RivalrySport | null {
  const u = (sport ?? '').toString().trim().toUpperCase()
  if (!u) return null
  const canonical = MAP[u] ?? u
  return isSupportedSport(canonical) ? canonical : null
}

export function getRivalrySportLabel(sport: string | null | undefined): string {
  const s = normalizeSportForRivalry(sport)
  if (!s) return 'Unknown'
  const labels: Record<RivalrySport, string> = {
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

export function isSupportedRivalrySport(sport: string | null | undefined): boolean {
  return normalizeSportForRivalry(sport) != null
}

