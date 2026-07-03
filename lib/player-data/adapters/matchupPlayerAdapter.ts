/**
 * Start/sit / matchup cards — map unified wire rows to compact display context (no scoring engine).
 */

import type { UnifiedPlayerWireDto } from '@/lib/player-data/serializeUnifiedPlayerForApi'

export type MatchupPlayerCardContext = {
  playerId: string
  name: string
  position: string | null
  team: string | null
  headshotUrl: string | null
  teamLogoUrl: string | null
  injuryStatus: string | null
  activeStatus: string | null
  projectedPoints: number | null
  liveStatsAvailable: boolean
  statsSource: string | null
  projectionSource: string | null
  lowConfidence: boolean
  staleDataWarnings: string[]
}

export function matchupContextFromUnifiedWire(row: UnifiedPlayerWireDto): MatchupPlayerCardContext {
  const canonical = row.nflRedraft ?? null
  const stats = row.normalizedStats ?? {}
  const keys = Object.keys(stats).filter((k) => k !== 'projectionSource')
  return {
    playerId: row.id,
    name: row.name,
    position: canonical?.fantasyPosition ?? row.position,
    team: canonical?.teamAbbr ?? row.team,
    headshotUrl: canonical?.media.headshot.url ?? row.headshotUrl,
    teamLogoUrl: canonical?.media.teamLogo.url ?? row.teamLogoUrl,
    injuryStatus: canonical?.injury.designation ?? row.injuryStatus,
    activeStatus: canonical?.activeStatus ?? null,
    projectedPoints: canonical?.currentProjection.weeklyProjectedPoints ?? row.projectedPoints,
    liveStatsAvailable: keys.length > 2,
    statsSource: row.statsSource,
    projectionSource: canonical?.currentProjection.source ?? row.projectionsSource,
    lowConfidence: row.lowConfidence === true || Boolean(canonical?.fallbacks.length),
    staleDataWarnings: canonical?.dataFreshness.staleWarnings ?? [],
  }
}
