/**
 * Start/sit / matchup cards — map unified wire rows to compact display context (no scoring engine).
 */

import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'

export type MatchupPlayerCardContext = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  injuryStatus: string | null
  projectedPoints: number | null
  liveStatsAvailable: boolean
  statsSource: string | null
  lowConfidence: boolean
}

export function matchupContextFromUnifiedWire(row: UnifiedPlayerWireDto): MatchupPlayerCardContext {
  const stats = row.normalizedStats ?? {}
  const keys = Object.keys(stats).filter((k) => k !== 'projectionSource')
  return {
    playerId: row.id,
    name: row.name,
    position: row.position,
    team: row.team,
    injuryStatus: row.injuryStatus,
    projectedPoints: row.projectedPoints,
    liveStatsAvailable: keys.length > 2,
    statsSource: row.statsSource,
    lowConfidence: row.lowConfidence === true,
  }
}
