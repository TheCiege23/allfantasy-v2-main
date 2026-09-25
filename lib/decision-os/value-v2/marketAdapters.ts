import type { FantasyCalcPlayer } from '@/lib/fantasycalc'
import type { FantasyCalcSnapshotMetadata } from '@/lib/fantasycalc-db'
import type { RawPlayerValueRow } from '@/lib/decision-os/world/facts'
import type { MarketObservationV2 } from './market'

/** No name matching here: the row must be resolved by its stable provider identity. */
export function fantasyCalcObservation(player: FantasyCalcPlayer, metadata: FantasyCalcSnapshotMetadata): MarketObservationV2 | null {
  if (!player.player.sleeperId) return null
  return { assetId: player.player.sleeperId, source: metadata.source, observedAt: metadata.observedAt,
    timestampResolution: 'instant', cohort: { sport: 'NFL', format: metadata.settings.isDynasty ? 'dynasty' : 'redraft',
      numQbs: metadata.settings.numQbs, numTeams: metadata.settings.numTeams, ppr: metadata.settings.ppr },
    value: player.value, liquidity: player.maybeTradeFrequency ?? null, trend30d: player.trend30Day ?? null,
    standardDeviation: player.maybeMovingStandardDeviation ?? null, sampleSize: null }
}

/** New history preserves exact observation metadata. Legacy rows retain day precision and unknown axes. */
export function playerValueRowObservation(row: RawPlayerValueRow): MarketObservationV2 | null {
  if (!row.sleeperId || row.source !== 'FANTASYCALC' || !['DYNASTY', 'REDRAFT'].includes(row.format) || !['ONE_QB', 'SUPERFLEX'].includes(row.qbFormat)) return null
  const stamp = row.observedAt ?? row.capturedAt
  return { assetId: row.sleeperId, source: 'PlayerValueSnapshot:FANTASYCALC',
    observedAt: stamp instanceof Date && Number.isFinite(+stamp) ? stamp.toISOString() : null,
    timestampResolution: row.observedAt == null ? 'day' : 'instant', cohort: { sport: 'NFL', format: row.format === 'DYNASTY' ? 'dynasty' : 'redraft',
      numQbs: row.qbFormat === 'SUPERFLEX' ? 2 : 1, numTeams: row.marketNumTeams ?? null, ppr: row.marketPpr ?? null },
    value: row.value, liquidity: row.tradeFrequency, trend30d: row.trend30d,
    standardDeviation: row.marketStdDev ?? null, sampleSize: null }
}
