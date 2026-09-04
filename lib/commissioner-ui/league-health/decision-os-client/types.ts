import type { CommissionerPlatformResponse, CommissionerRecommendationContract } from '../../contracts'
import type { SeverityTier } from '../../tokens/colors'

export interface LeagueHealthDeductionLine {
  label: string
  points: number
}

export interface LeagueHealthSubScores {
  engagement: number
  retention: number
  competitiveBalance: number
  risk: number
}

export interface LeagueHealthDetail {
  score: number
  tier: SeverityTier
  baseline: number
  deductions: LeagueHealthDeductionLine[]
  subScores: LeagueHealthSubScores
}

export interface LeagueHealthRisk {
  id: string
  description: string
  severity: SeverityTier
  category: string
  ageInDays: number
  status: 'new' | 'ongoing' | 'resolving'
}

export interface LeagueHealthEvidencePoint {
  label: string
  detail: string
}

/** League Health owns all League Health intelligence — Mission Control and every other consumer reach it only through this interface. */
export interface LeagueHealthClient {
  getHealthDetail(): Promise<CommissionerPlatformResponse<LeagueHealthDetail>>
  getRisks(): Promise<CommissionerPlatformResponse<LeagueHealthRisk[]>>
  getEvidence(): Promise<CommissionerPlatformResponse<LeagueHealthEvidencePoint[]>>
  getRecommendations(): Promise<CommissionerPlatformResponse<CommissionerRecommendationContract[]>>
}
