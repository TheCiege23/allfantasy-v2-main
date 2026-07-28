/**
 * Fantasy OS — the CURRENT-STATE normalized loader shared by BOTH the manual resync and the scheduled
 * collector (Launch Batch 2 · B6). It replaces the heavy `runImportedLeagueNormalizationPipeline`
 * default: it fetches only the bounded current state (no `previous_league_id` history chain, no full
 * player map, no all-week sweep) and runs it through the SAME normalizer — so manual + scheduled sync
 * share one loader, one normalized shape, and one persistence path. Read-only against Sleeper.
 */
import { fetchSleeperCurrentStateForImport } from '@/lib/league-import/sleeper/SleeperCurrentStateFetchService'
import { runImportNormalizationPipeline } from '@/lib/league-import/ImportNormalizationPipeline'
import type { NormalizedImportResult } from '@/lib/league-import/types'

/**
 * Fetch + normalize the CURRENT state of a connected Sleeper league. Throws on a hard provider failure
 * (unresolvable league) so the runner records the scope incomplete, never advances freshness, and never
 * lets persistence run against an empty payload (so valid stored data is never erased).
 */
export async function fetchCurrentStateNormalizedFromSleeper(
  externalLeagueId: string,
): Promise<NormalizedImportResult> {
  const raw = await fetchSleeperCurrentStateForImport(externalLeagueId)
  if (!raw?.league?.league_id) {
    throw new Error('sleeper current-state fetch failed: league not found')
  }
  return runImportNormalizationPipeline({ provider: 'sleeper', raw })
}
