/** Canonical value contract. Null means unknown; zero requires evidence. */
const VALUE_VERSION = '2.0' as const
export type AssetKind = 'player' | 'draft_pick' | 'faab' | 'devy' | 'keeper' | 'contract' | 'salary' | 'future_consideration'
interface Evidence {
  source: string
  asOf: string
  sampleSize: number | null
}
interface Estimate {
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
