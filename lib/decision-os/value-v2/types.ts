/** Canonical value contract. Null means unknown; zero requires evidence. */
export const VALUE_VERSION = '2.0' as const
export type Horizon = 1 | 3 | 5
export type AssetKind = 'player' | 'draft_pick' | 'faab' | 'devy' | 'keeper' | 'contract' | 'salary' | 'future_consideration'
export interface Evidence {
  source: string
  asOf: string
  sampleSize: number | null
}
export interface Estimate {
  value: number
  /** Bounds are supplied by a source/model, never fabricated from confidence. */
  low: number | null
  high: number | null
  evidence: Evidence
}
export interface MarketValueSnapshotV2 {
  observation?: import('./market').MarketObservationV2 | null
  standardDeviation?: number | null
  version: typeof VALUE_VERSION
  assetId: string
  kind: AssetKind
  cohort: string
  capturedAt: string
  marketValue: Estimate | null
  liquidity: number | null
  trend30d: number | null
  gaps: string[]
}
export interface ScoringRule {
  stat: string
  points: number
  positions?: readonly string[]
  /** Event counts for distance/threshold bonuses must be supplied as components. */
}
export interface StartingSlot {
  id: string
  count: number
  eligiblePositions: readonly string[]
}
export interface LeagueValueContext {
  leagueId: string
  cohort: string
  teamCount: number
  scoring: readonly ScoringRule[] | null
  referenceScoring: readonly ScoringRule[] | null
  slots: readonly StartingSlot[] | null
  referenceSlots: readonly StartingSlot[] | null
  referenceTeamCount: number | null
}
export interface LeagueValueV2 {
  market: MarketValueSnapshotV2
  leagueId: string
  leagueValue: Estimate | null
  scoringFit: number | null
  demandFit: number | null
  gaps: string[]
}
/** All deltas are in the same value units, with externally versioned conversion evidence. */
export interface UtilityTerms {
  lineup: Estimate | null
  playoffOrSurvival: Estimate | null
  horizon: Record<Horizon, Estimate | null>
  rosterOption: Estimate | null
  riskCost: Estimate | null
}
export interface ValueDecisionV2 {
  version: typeof VALUE_VERSION
  assetId: string
  leagueId: string
  userId: string
  marketValue: Estimate | null
  leagueValue: Estimate | null
  userUtility: Record<Horizon, Estimate | null>
  terms: UtilityTerms
  gaps: string[]
}
