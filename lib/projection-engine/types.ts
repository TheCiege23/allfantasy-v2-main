import type { NormalizedPlayerSportsProfile } from '@/lib/sports-data-normalization/types'

/**
 * Single cross-tool projection shape — values are always derived from
 * `resolveNormalizedPlayerSportsProfiles` + `effectiveFantasyPoints` (no invented stats).
 */
export type FantasyProjectionEngineRow = {
  playerKey: string
  rosterPlayerId: string | null
  profile: NormalizedPlayerSportsProfile
  projectedFantasyPoints: number | null
  projectionConfidence: number | null
  projectionFloor: number | null
  projectionCeiling: number | null
  adjustedProjectionReasoning: string[]
  /** When upstream identity or data is thin, tools should surface degraded state — never silent wrong binds. */
  identityConfidence: 'full' | 'degraded' | 'ambiguous'
  identityNotes: string[]
}

