/**
 * Pure policy for MyLeagueCard's per-league, DB-backed fetches.
 *
 * Root cause this encodes: the dashboard board renders one `MyLeagueCard` per league
 * (`DashboardOverview.tsx` — `myLeaguesList.map(...)`, no cap), and each card independently calls
 * `/api/league/detail`, `/api/leagues/[id]/season-forecast`, `/api/leagues/[id]/matchups`, and
 * polls `/api/shared/activity` every 90s via `useActivityFeed`. All of those resolve the league out
 * of the `leagues` table.
 *
 * AF Legacy board rows are different: `getLegacyLeagueBoardItems` (lib/dashboard/
 * get-dashboard-league-list.ts) emits rows whose `id` is a **`LegacyLeague`** id with no row in
 * `leagues`, marked `hasUnifiedRecord: false`. For those rows every one of the fetches above is
 * dead on arrival — `/api/league/detail` 404s by construction, which is the same meaning
 * `LeagueSyncDashboard` already renders as `hasUnifiedRecord ? 'Open League' : 'Sync & Open'`.
 *
 * Measured against production on a real account with **543** legacy leagues (2026-07-17):
 * ~2,000 requests per dashboard load, then a sustained ~6 req/s from the 90s activity poll for as
 * long as the tab stayed open. That exhausted a 1 GB Postgres and surfaced as `53200 out of memory`
 * on unrelated routes plus 645 `/api/league/detail` 404s — the queries themselves were innocent
 * (the blamed `roster.findMany()` runs in 0.066 ms).
 *
 * `/api/league-health` is deliberately NOT covered: its non-`decision_os` branch is
 * `monitorHealth(parsed.data)`, a pure function over the POST body that never reads the DB, so it
 * returns a real status for legacy rows and adds no database load.
 *
 * Extracted as a pure function so the policy is unit-testable without rendering MyLeagueCard —
 * matching lib/league/leagueTabSync.ts and lib/matchup-center/tabTransition.
 */

/** The only field this policy reads. Structural so both UserLeague and board rows satisfy it. */
export interface LeagueFetchPolicyInput {
  hasUnifiedRecord?: boolean | null
}

/**
 * Should a league card issue its league-scoped, `leagues`-table-backed fetches?
 * - `true`  → the row has a real `leagues` record (or predates the flag), so the APIs can answer.
 * - `false` → AF Legacy-only row; every such call would 404. Skip them.
 *
 * Undefined/null are treated as fetchable: only an explicit `false` marks a legacy-only row, and
 * defaulting the other way would silently blank cards for any caller that omits the flag.
 */
export function shouldFetchLeagueScopedData(league: LeagueFetchPolicyInput): boolean {
  return league.hasUnifiedRecord !== false
}
