/**
 * Sleeper CURRENT-STATE fetch (Launch Batch 2 · B6) — the bounded read used by the durable read-model
 * refresh (manual resync + scheduled collector). Unlike `fetchSleeperLeagueForImport` (initial import),
 * this fetches ONLY the mutable current state the durable scopes persist:
 *   - GET /league/{id}              → current league state/settings/scoring/commissioner metadata
 *   - GET /league/{id}/users        → managers (owner names, commissioner/co-owner metadata)
 *   - GET /league/{id}/rosters      → current rosters (players/starters/reserve/taxi, W-L, points → standings)
 *   - GET /league/{id}/traded_picks → current future-pick ownership
 *   - GET /league/{id}/matchups/{w} → a BOUNDED current-week window (TeamPerformance), never all 18 weeks
 *   - GET /state/nfl                → the live week, used only to gate the bounded matchup window (in-season)
 *
 * It DELIBERATELY does NOT (these are the deep-dynasty timeout, and are owned by the initial import +
 * historical backfill, never a routine refresh):
 *   - traverse the `previous_league_id` history chain,
 *   - fetch drafts / every historical week / transactions,
 *   - download the full (~5MB) NFL player map — the durable scopes persist player IDs, not names.
 *
 * The result is the SAME `SleeperImportPayload` shape the initial import produces (with the historical
 * sections empty), so the SAME normalizer + persistence apply — no second canonical data model. Read-only:
 * every call is a keyless public GET; nothing is ever written upstream to Sleeper. Reuses the shared
 * resilient `fetchSleeperJson` primitive (per-request timeout + bounded retries) so no call can hang.
 */
import { fetchSleeperJson, SLEEPER_BASE } from './SleeperLeagueFetchService'
import type { SleeperImportPayload } from '../adapters/sleeper/types'

/** Recent matchup weeks fetched for current-season TeamPerformance (bounded provider load). */
const CURRENT_MATCHUP_WINDOW = 3
const MAX_WEEK = 18

export interface CurrentStateFetchOptions {
  /** Recent matchup weeks to include for TeamPerformance (default 3). 0 = skip matchups entirely. */
  matchupWindow?: number
  /** Override the resolved current week (deterministic tests). `null` forces offseason (no matchups). */
  currentWeek?: number | null
}

/**
 * Resolve the bounded set of matchup weeks to fetch for the current season. Only fetches weeks when the
 * league season matches the live NFL-state season and the season is underway (week >= 1). In the
 * offseason this returns [] (no matchups exist yet), so a refresh is just the core league calls. Uses
 * the bounded resilient fetcher for `/state/nfl`, so it can never hang.
 */
async function resolveCurrentMatchupWeeks(
  leagueSeason: string | undefined,
  window: number,
  currentWeekOverride: number | null | undefined,
  warnings: string[],
): Promise<number[]> {
  if (window <= 0) return []
  let week: number | null
  if (currentWeekOverride !== undefined) {
    week = currentWeekOverride
  } else {
    const state = await fetchSleeperJson<{ week?: number; season?: string }>(
      `${SLEEPER_BASE}/state/nfl`,
      { warnings, label: 'nfl state' },
    )
    const stateSeason = state?.season != null ? String(state.season) : null
    // Only trust the live week when it belongs to THIS league's season (avoids fetching an unrelated
    // season's matchups for a past-season connected league).
    if (leagueSeason && stateSeason && leagueSeason !== stateSeason) return []
    week = typeof state?.week === 'number' ? state.week : null
  }
  if (week == null || !Number.isFinite(week) || week < 1) return []
  const top = Math.min(MAX_WEEK, Math.floor(week))
  const weeks: number[] = []
  for (let w = Math.max(1, top - window + 1); w <= top; w++) weeks.push(w)
  return weeks
}

/**
 * Fetch a bounded CURRENT-STATE Sleeper payload suitable for the durable read-model refresh. Returns
 * null only when the league itself cannot be resolved (a hard failure the loader rethrows so the runner
 * records the scope incomplete and never advances freshness or erases stored data).
 */
export async function fetchSleeperCurrentStateForImport(
  leagueId: string,
  options: CurrentStateFetchOptions = {},
): Promise<SleeperImportPayload | null> {
  const cleanId = leagueId.trim()
  if (!cleanId) return null
  const warnings: string[] = []

  const league = await fetchSleeperJson<SleeperImportPayload['league']>(
    `${SLEEPER_BASE}/league/${cleanId}`,
    { warnings, label: 'league' },
  )
  if (!league?.league_id) return null

  const matchupWindow = options.matchupWindow ?? CURRENT_MATCHUP_WINDOW
  const matchupWeeks = await resolveCurrentMatchupWeeks(
    league.season,
    matchupWindow,
    options.currentWeek,
    warnings,
  )

  const [users, rosters, tradedPicksRaw, matchupResults] = await Promise.all([
    fetchSleeperJson<SleeperImportPayload['users']>(`${SLEEPER_BASE}/league/${cleanId}/users`, {
      warnings,
      label: 'league users',
    }),
    fetchSleeperJson<SleeperImportPayload['rosters']>(`${SLEEPER_BASE}/league/${cleanId}/rosters`, {
      warnings,
      label: 'league rosters',
    }),
    fetchSleeperJson<SleeperImportPayload['tradedPicks']>(
      `${SLEEPER_BASE}/league/${cleanId}/traded_picks`,
      { warnings, label: 'traded picks' },
    ),
    Promise.all(
      matchupWeeks.map((week) =>
        fetchSleeperJson<{ roster_id: number; matchup_id: number; points: number }[]>(
          `${SLEEPER_BASE}/league/${cleanId}/matchups/${week}`,
          { warnings, label: `matchups week ${week}` },
        ).then((m) => ({ week, m })),
      ),
    ),
  ])

  const matchupsByWeek: NonNullable<SleeperImportPayload['matchupsByWeek']> = []
  for (const { week, m } of matchupResults) {
    if (m?.length) matchupsByWeek.push({ week, matchups: m })
  }

  return {
    league,
    users: users ?? undefined,
    rosters: rosters ?? undefined,
    matchupsByWeek,
    // Current-state refresh: historical sections are intentionally empty — the `previous_league_id`
    // chain, full-season transactions/drafts, and the player map are owned by the initial import and
    // the one-time historical backfill, never a routine refresh.
    transactions: [],
    draftPicks: [],
    // A failed traded_picks fetch returns null → `undefined` here → the normalizer omits the field →
    // the updater no-ops (existing picks preserved). An empty array is a legitimate "none traded".
    tradedPicks: Array.isArray(tradedPicksRaw) ? tradedPicksRaw : undefined,
    playerMap: {},
    previousSeasons: [],
    fetchWarnings: warnings.length > 0 ? warnings : undefined,
  }
}
