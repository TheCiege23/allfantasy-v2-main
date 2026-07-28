/**
 * Fantasy OS — Sleeper scope fetcher for the durable runner.
 *
 * The runner calls `fetchScope(scope, checkpoint, now)` once per scope. This fetcher resolves the FULL
 * normalized Sleeper payload exactly ONCE per run (the promise is memoized upstream) and slices it per
 * scope — so a per-league sync is a single provider burst regardless of scope count, honoring Sleeper's
 * safe request limits. The underlying `fetchSleeperLeagueForImport` already retries each HTTP call with
 * backoff/timeout and treats 404/empty as legitimate no-data, so a hard failure here is genuinely hard.
 *
 * Read-only: every provider call is a GET against Sleeper's public keyless API.
 */
import { createHash } from 'crypto'
import type { NormalizedImportResult } from '@/lib/league-import/types'
import type { ScopeFetcher, ScopeFetchResult } from '@/lib/fantasy-os/sync/runner'
import type { SleeperSyncScope } from './types'

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)
}

/** Deterministic content fingerprint per scope — same upstream data ⇒ same checkpoint token. */
function checkpointForScope(scope: SleeperSyncScope, n: NormalizedImportResult): string {
  switch (scope) {
    case 'league_state':
      return hash({
        name: n.league.name,
        status: n.league.status ?? null,
        scoring: n.league.scoring ?? null,
        leagueSize: n.league.leagueSize,
        isDynasty: n.league.isDynasty,
        roster_positions: (n.league as Record<string, unknown>).roster_positions ?? null,
        scoring_settings: (n.league as Record<string, unknown>).scoring_settings ?? null,
      })
    case 'teams_rosters':
      return hash(
        [...n.rosters]
          .sort((a, b) => a.source_team_id.localeCompare(b.source_team_id))
          .map((r) => ({
            t: r.source_team_id,
            m: r.source_manager_id,
            w: r.wins, l: r.losses, ti: r.ties, pf: r.points_for,
            p: [...(r.player_ids ?? [])].sort(),
            s: [...(r.starter_ids ?? [])].sort(),
            ir: [...(r.reserve_ids ?? [])].sort(),
            tx: [...(r.taxi_ids ?? [])].sort(),
          })),
      )
    case 'traded_picks':
      return hash(
        [...(n.traded_picks ?? [])]
          .map((p) => `${p.season}:${p.round}:${p.original_roster_id}:${p.current_owner_roster_id}`)
          .sort(),
      )
    default:
      return hash(scope)
  }
}

/** Marker records per scope (drive the runner's request accounting; persistence reads the payload). */
function recordsForScope(scope: SleeperSyncScope, n: NormalizedImportResult): { id: string }[] {
  switch (scope) {
    case 'league_state':
      return [{ id: `league:${n.source.source_league_id}` }]
    case 'teams_rosters':
      return n.rosters.map((r) => ({ id: `team:${r.source_team_id}` }))
    case 'traded_picks':
      return (n.traded_picks ?? []).map((p) => ({
        id: `pick:${p.season}:${p.round}:${p.original_roster_id}`,
      }))
    default:
      return []
  }
}

export function createSleeperScopeFetcher(deps: {
  loadNormalized: () => Promise<NormalizedImportResult>
}): ScopeFetcher {
  return async (scope: string, _checkpoint: string | null, _now: Date): Promise<ScopeFetchResult> => {
    // Throws on a hard provider failure → the runner records this scope incomplete, never advances
    // freshness, and never lets persistence run (so valid stored data is never erased).
    const normalized = await deps.loadNormalized()
    const s = scope as SleeperSyncScope
    return {
      records: recordsForScope(s, normalized),
      nextCheckpoint: checkpointForScope(s, normalized),
      // One logical fetch operation per scope; HTTP-level retries are absorbed inside the fetch service.
      attempts: 1,
      logical: 1,
      notFound: 0,
      cacheHits: 0,
    }
  }
}
