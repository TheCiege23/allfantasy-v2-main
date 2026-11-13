/**
 * Matchup Command Center — aggregation helpers + refresh policy.
 * Server builds base payload in `matchupCenterService`; this layer attaches client meta.
 */

import type { MatchupCenterPayload } from '@/lib/matchup-center/types'

/** Poll frequently while games are in progress. */
const MATCHUP_LIVE_REFRESH_MS = 30_000

/** Lighter polling before kickoff / tip. */
const MATCHUP_UPCOMING_REFRESH_MS = 120_000

/** After final, no need to poll aggressively. */
export const MATCHUP_FINAL_REFRESH_MS = 0

export function applyMatchupCommandCenterMeta(
  payload: Omit<MatchupCenterPayload, 'refreshIntervalMs'>,
): MatchupCenterPayload {
  const live = payload.matchupStatus === 'live'
  const final = payload.matchupStatus === 'final'
  const refreshIntervalMs = final ? MATCHUP_FINAL_REFRESH_MS : live ? MATCHUP_LIVE_REFRESH_MS : MATCHUP_UPCOMING_REFRESH_MS
  return { ...payload, refreshIntervalMs }
}
