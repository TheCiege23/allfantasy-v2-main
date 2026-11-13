import type { SportCode } from '@/lib/player-projection'

export type WindowStatus =
  | 'Contender'
  | 'Rising'
  | 'Competitive'
  | 'Declining'
  | 'Rebuilding'
  | 'Tank Risk'

export type TrajectoryDirection = 'rising' | 'flat' | 'falling'

interface RosterAgeMetrics {
  averageAge: number
  weightedStarterAge: number
  youngCoreScore: number
  agingRiskScore: number
}

export interface FutureStrengthSnapshot {
  season: number
  projectedStrengthNextYear: number
  projectedStrength3Years: number
  projectedStrength5Years: number
  rebuildProbability: number
  contenderProbability: number
  windowStartYear: number | null
  windowEndYear: number | null
  volatilityScore: number
}

export interface RecentPerformanceMetrics {
  recentWinPct: number
  lastNGames: number
  standingsRank: number | null
  standingsSize: number | null
}

export interface TeamWindowInputs {
  sport: SportCode
  leagueId: string
  teamId: string
  season: number
  rosterAge: RosterAgeMetrics
  futureStrength: FutureStrengthSnapshot
  recentPerformance: RecentPerformanceMetrics
}

export interface TeamWindowProfile {
  teamId: string
  leagueId: string
  windowStatus: WindowStatus
  windowStartYear: number | null
  windowEndYear: number | null
  rebuildRiskScore: number
  dynastyStrengthScore: number
  trajectoryDirection: TrajectoryDirection
  updatedAt: Date
}

