/**
 * Dynasty Engine — shared types. Sport-aware across NFL, NHL, NBA, MLB, NCAAB, NCAAF, Soccer.
 */
import {
  DEFAULT_SPORT,
  SUPPORTED_SPORTS,
  normalizeToSupportedSport,
  type SupportedSport,
} from '@/lib/sport-scope'

const DYNASTY_SPORTS: readonly SupportedSport[] = [...SUPPORTED_SPORTS]

export type DynastySport = SupportedSport

export function normalizeSportForDynasty(sport: string): DynastySport {
  const u = sport?.toUpperCase?.() || DEFAULT_SPORT
  if (DYNASTY_SPORTS.includes(u as DynastySport)) return normalizeToSupportedSport(u)
  const map: Record<string, DynastySport> = {
    NFL: 'NFL',
    NHL: 'NHL',
    NBA: 'NBA',
    MLB: 'MLB',
    NCAAB: 'NCAAB',
    NCAAF: 'NCAAF',
    SOCCER: 'SOCCER',
  }
  return normalizeToSupportedSport(map[u] ?? u)
}

export interface DynastyProjectionOutput {
  projectionId: string
  teamId: string
  leagueId: string
  sport: string
  championshipWindowScore: number
  rebuildProbability: number
  rosterStrength3Year: number
  rosterStrength5Year: number
  agingRiskScore: number
  futureAssetScore: number
  season?: number
  createdAt: string
}
