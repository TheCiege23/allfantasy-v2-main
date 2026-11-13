import type { PickWeight, PlayerWeight } from '@/lib/upstream-apis'

type SportCode = 'NFL' | 'NBA' | 'MLB' | string

export interface DynastyLeagueContext {
  sport: SportCode
  season: number
  isDynasty: boolean
  isSuperFlex: boolean
  isTightEndPremium: boolean
  teamCount: number
}

export interface PlayerDynastyAsset {
  playerId: string
  name: string
  position: string
  age: number | null
  dynastyValue: number
  recentInjuryScore?: number | null
  gamesPlayedLastSeason?: number | null
  draftRound?: number | null
  yearsInLeague?: number | null
}

export interface FuturePickAsset {
  season: number
  round: number
  pickNumber?: number
  ownerTeamId: string
}

export interface TeamDynastyInputs {
  leagueId: string
  teamId: string
  leagueContext: DynastyLeagueContext
  players: PlayerDynastyAsset[]
  futurePicks: FuturePickAsset[]
}

/** Optional weather-aware layer; does not replace core dynasty math. */
export type DynastyProjectTeamOptions = {
  weatherAwareProjections?: boolean
  /** Per-player AF vs baseline fantasy points; used for a small roster-level blend when weather-aware. */
  afProjectionByPlayerId?: Record<string, { afProjection: number; baselineProjection: number }>
}

export interface RosterFutureValueBreakdown {
  nextYearStrength: number
  threeYearStrength: number
  fiveYearStrength: number
  agingRiskScore: number
  injuryRiskScore: number
}

export interface DraftPickValueBreakdown {
  totalDynastyValue: number
  nearTermContribution: number
  longTermContribution: number
}

export interface LongTermStrengthProjection {
  projectedStrengthNextYear: number
  projectedStrength3Years: number
  projectedStrength5Years: number
  rebuildProbability: number
  contenderProbability: number
  windowStartYear: number | null
  windowEndYear: number | null
  volatilityScore: number
}

export interface DynastyProjectionSnapshotPayload {
  leagueId: string
  sportType: string
  teamId: string
  season: number
  projectedStrengthNextYear: number
  projectedStrength3Years: number
  projectedStrength5Years: number
  rebuildProbability: number
  contenderProbability: number
  windowStartYear: number | null
  windowEndYear: number | null
  volatilityScore: number
  confidenceScore: number
  /** Present when `weatherAwareProjections` + per-player AF overrides were applied. */
  weatherAwareBlendFactor?: number
}

