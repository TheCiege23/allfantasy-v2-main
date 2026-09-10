import type { AssetKind, MarketValueSnapshotV2 } from './types'
import { completeMarketCohort, marketCohortKey, type MarketCohortV2 } from './cohort'

export interface MarketObservationV2 {
  assetId: string
  source: string
  observedAt: string | null
  timestampResolution: 'instant' | 'day'
  cohort: MarketCohortV2
  value: number
  liquidity: number | null
  trend30d: number | null
  /** Dispersion is not a calibrated confidence interval. */
  standardDeviation: number | null
  sampleSize: number | null
}

export interface MarketSnapshotPolicy {
  now: string
  maxAgeMs: number
  expectedCohort?: MarketCohortV2
}

/** Observations remain inspectable when they cannot support a current recommendation. */
export function marketSnapshot(input: {
  assetId: string
  kind: AssetKind
  observation: MarketObservationV2 | null
  policy: MarketSnapshotPolicy
  expectedValue?: number | null
}): MarketValueSnapshotV2 {
  const { observation: observation, policy, assetId, kind } = input
  const now = Date.parse(policy.now)
  if (!assetId || !Number.isFinite(now) || !Number.isFinite(policy.maxAgeMs) || policy.maxAgeMs < 0) throw new Error('Invalid market capture policy')
  const gaps: string[] = []
  let cohort = 'market-v2:unknown'
  if (observation) {
    try { cohort = marketCohortKey(observation.cohort) } catch { gaps.push('market_cohort_invalid') }
    if (!completeMarketCohort(observation.cohort)) gaps.push('market_cohort_incomplete')
    if (policy.expectedCohort && cohort !== marketCohortKey(policy.expectedCohort)) gaps.push('market_cohort_mismatch')
    if (observation.assetId !== assetId) gaps.push('market_identity_mismatch')
    if (input.expectedValue !== undefined && input.expectedValue !== observation.value) gaps.push('market_value_observation_mismatch')
    if (!observation.source.trim()) gaps.push('market_source_missing')
    if (!Number.isFinite(observation.value) || observation.value < 0) gaps.push('market_value_invalid')
    const observed = observation.observedAt === null ? NaN : Date.parse(observation.observedAt)
    if (!Number.isFinite(observed)) gaps.push('market_timestamp_missing')
    else if (observed > now) gaps.push('market_timestamp_in_future')
    else if (now - observed > policy.maxAgeMs) gaps.push('market_stale')
    if (observation.timestampResolution === 'day') gaps.push('market_timestamp_day_precision')
  } else gaps.push('market_unpriced')
  const blocked = gaps.some(g => g !== 'market_timestamp_day_precision')
  const finite = (v: number | null | undefined) => typeof v === 'number' && Number.isFinite(v) ? v : null
  const liquidity = finite(observation?.liquidity)
  const deviation = finite(observation?.standardDeviation)
  const sampleSize = observation?.sampleSize
  const marketValue = observation && !blocked ? {
    value: observation.value, low: null, high: null,
    evidence: { source: observation.source, asOf: observation.observedAt!,
      sampleSize: typeof sampleSize === 'number' && Number.isInteger(sampleSize) && sampleSize >= 0 ? sampleSize : null },
  } : null
  return { version: '2.0', assetId, kind, cohort, capturedAt: policy.now, marketValue,
    liquidity: liquidity !== null && liquidity >= 0 ? liquidity : null, trend30d: finite(observation?.trend30d),
    observation, standardDeviation: deviation !== null && deviation >= 0 ? deviation : null,
    gaps: [...gaps, 'market_uncertainty_not_calibrated'] }
}
