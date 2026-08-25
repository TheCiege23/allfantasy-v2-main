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

/** Structural so both UserLeague and board rows satisfy it. */
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
 *
 * Tournament-hub rows are excluded too — see `resolvesToLeagueRecord` below, which this delegates
 * to. Their `id` is a `LegacyTournament` key, so `/api/league/detail` 404s for exactly the same
 * reason it does for a legacy row, even though they carry `hasUnifiedRecord: true`.
 */
export function shouldFetchLeagueScopedData(league: LeagueRecordPolicyInput): boolean {
  return resolvesToLeagueRecord(league)
}

/**
 * The second way a board row's `id` fails to resolve in `leagues`, and the one `hasUnifiedRecord`
 * cannot express: **tournament hubs**.
 *
 * `normalizedTournaments` (lib/dashboard/get-dashboard-league-list.ts) emits one row per
 * `LegacyTournament` with `id`/`unifiedLeagueId`/`navigationLeagueId` all set to the
 * **`LegacyTournament` primary key** and `hasUnifiedRecord: true`. There is no `leagues` row behind
 * that id, so it is the same class of failure as an AF Legacy row — but it is marked the opposite
 * way, so every `hasUnifiedRecord !== false` filter in the codebase lets it straight through into
 * `prisma.league.findUnique({ where: { id } })`, which returns null.
 *
 * `hasUnifiedRecord: false` is deliberately NOT the fix. It is read as "AF Legacy career-import
 * snapshot" and drives *display* — `lib/core-app/myLeagues.ts` files those rows under History, and
 * `LeagueSyncDashboard` offers them a "Sync & Open" button. A tournament is neither. It needs its
 * own discriminator, which is why rows now carry `kind`.
 */
export type DashboardRowKind = 'league' | 'tournament' | 'legacy'

/** Fields the id-resolution policy reads. Structural so board rows and `UserLeague` both satisfy it. */
export interface LeagueRecordPolicyInput extends LeagueFetchPolicyInput {
  kind?: DashboardRowKind | null
  league_variant?: string | null
  leagueVariant?: string | null
}

/**
 * Tournament-hub board row?
 *
 * `kind` is authoritative. The `league_variant` fallback covers rows built before `kind` existed
 * (hand-built fixtures, cached client payloads) and is safe: no `League` row is ever written with
 * `leagueVariant: 'tournament_hub'` — the only tournament variant on a real league row is
 * `'tournament_mode'` (lib/specialty-league/registry.ts, lib/simulation/simulators/tournamentSimulator.ts).
 * It is the same predicate `lib/dashboard/league-list-destination.ts` already routes on.
 */
export function isTournamentHubRow(row: LeagueRecordPolicyInput): boolean {
  if (row.kind === 'tournament') return true
  const variant = String(row.league_variant ?? row.leagueVariant ?? '').trim().toLowerCase()
  return variant === 'tournament_hub'
}

/**
 * Does this row's `id` name a row in the `leagues` table?
 *
 * The one predicate to gate any `prisma.league.*({ where: { id } })`, any `leagueId: { in: [...] }`,
 * and any league-scoped API call on. It is the union of BOTH id-space escapes:
 *   - `hasUnifiedRecord === false` → AF Legacy (`LegacyLeague.id`)
 *   - `kind === 'tournament'`      → tournament hub (`LegacyTournament.id`)
 *
 * ⚠ NEVER gate on `hasUnifiedRecord` alone. Tournament rows set it `true`, which is the bug.
 */
export function resolvesToLeagueRecord(row: LeagueRecordPolicyInput): boolean {
  if (isTournamentHubRow(row)) return false
  return row.hasUnifiedRecord !== false
}
