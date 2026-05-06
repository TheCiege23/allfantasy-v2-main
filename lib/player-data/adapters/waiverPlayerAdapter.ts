/**
 * Waiver wire — preserve `UnifiedPlayerWireDto` and attach display / AI helpers.
 */

import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import type { PlayerDataAdapterFlags } from '@/lib/player-data/adapters/adapterTypes'

export type WaiverPlayerAdapted = UnifiedPlayerWireDto & {
  /** Convenience for rows/cards */
  displayHeadshotUrl: string | null
  displayInjury: string | null
  displayProjection: number | null
  experienceSummary: string | null
}

function experienceSummaryFromWire(p: UnifiedPlayerWireDto): string | null {
  const y = p.product?.yearsExp
  if (y != null && Number.isFinite(Number(y))) {
    const n = Number(y)
    if (n === 0) return 'Rookie'
    return `${n} YOE`
  }
  if (p.nflRookieIsRookie === true) return 'Rookie'
  return null
}

export function adaptWaiverWirePlayer(
  row: UnifiedPlayerWireDto,
  _flags?: PlayerDataAdapterFlags,
): WaiverPlayerAdapted {
  return {
    ...row,
    displayHeadshotUrl: row.headshotUrl ?? null,
    displayInjury: row.injuryStatus ?? null,
    displayProjection:
      row.projectedPoints != null && Number.isFinite(Number(row.projectedPoints))
        ? Number(row.projectedPoints)
        : null,
    experienceSummary: experienceSummaryFromWire(row),
  }
}

export function adaptWaiverWirePlayerList(
  rows: UnifiedPlayerWireDto[],
  flags?: PlayerDataAdapterFlags,
): WaiverPlayerAdapted[] {
  return rows.map((r) => adaptWaiverWirePlayer(r, flags))
}
