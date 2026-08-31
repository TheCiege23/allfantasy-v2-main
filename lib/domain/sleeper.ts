/**
 * Commissioner OS · the Sleeper adapter. T-202.
 *
 * Sleeper first because its API is public and documented. Yahoo needs OAuth and
 * is rate-limited; ESPN has no supported public API and is normally reached
 * through undocumented endpoints that break without notice — not the one to
 * learn on.
 *
 * ─── SHAPES COME FROM COMMITTED CODE, NOT FROM PROBING ───────────────────────
 * The root CLAUDE.md's rule for the two contracted providers is "do not call
 * the API to determine a response shape", and the same discipline applies here
 * even though Sleeper has no `contracts/` directory. Every field below was read
 * out of code already in this repo:
 *
 *   lib/engine/context-builder.ts            SleeperLeagueRaw, SleeperRosterRaw,
 *                                            SleeperUserRaw
 *   lib/ai/league-settings-ai/sleeper.ts     metadata.team_name
 *   lib/ai-tools-start-sit/opponentMatchup.ts:65
 *                                            the team_name → display_name →
 *                                            username fallback order
 *
 * ─── HTTP IS INJECTED, WHICH IS THE ACCEPTANCE CRITERION IN STRUCTURAL FORM ──
 * "Recorded fixtures in CI — no live third-party calls in the gate." An adapter
 * that builds its own client can only be exercised against the real service, so
 * the fixture requirement has to be designed in rather than asserted about.
 * Nothing in this file names a host or imports fetch.
 *
 * ⚠ `api.sleeper.app` IS ON THE DB-FIRST GUARD'S MONITORED HOST LIST
 * (scripts/check-db-first-api-boundary.mjs:10). Keeping the URL out of here
 * means the guard has exactly one file to reason about when the live client is
 * written, rather than a literal buried in the domain layer.
 */

import {
  type ExternalLeague,
  type ExternalManager,
  type ExternalTeam,
  type Provider,
  type ProviderContext,
  type ProviderError,
  type ProviderPage,
  providerError,
} from './providers'
import { type Result, err, ok } from './result'

export const SLEEPER_PROVIDER_KEY = 'sleeper'

// ─── Wire shapes ─────────────────────────────────────────────────────────────
// Deliberately loose: every field is optional as far as we are concerned,
// because provider data is untrusted and a missing field must produce a
// MALFORMED refusal rather than an exception halfway through a sync.

export type SleeperLeagueRaw = {
  league_id?: string
  name?: string
  season?: string
  status?: string
  total_rosters?: number
}

export type SleeperRosterRaw = {
  roster_id?: number
  owner_id?: string | null
}

export type SleeperUserRaw = {
  user_id?: string
  display_name?: string
  username?: string
  metadata?: { team_name?: string } | null
}

/** GET a JSON path. Injected, so CI serves fixtures. */
export type SleeperHttp = (path: string) => Promise<Result<unknown, ProviderError>>

// ─── Mapping ─────────────────────────────────────────────────────────────────

/**
 * ⚠ team_name THEN display_name THEN username, AND THE ORDER IS NOT ARBITRARY.
 * `lib/ai-tools-start-sit/opponentMatchup.ts:65` already resolves it this way.
 * A manager list that falls back differently shows a different name from the
 * rest of the product for the same person, in the same league.
 */
export function managerDisplayName(u: SleeperUserRaw): string | null {
  return u.metadata?.team_name?.trim() || u.display_name?.trim() || u.username?.trim() || null
}

export function mapLeague(raw: SleeperLeagueRaw): Result<ExternalLeague, ProviderError> {
  if (!raw || typeof raw !== 'object' || !raw.league_id) {
    return err(providerError('MALFORMED', 'Sleeper returned a league with no league_id.'))
  }
  return ok({
    externalLeagueId: raw.league_id,
    // A nameless league is legal on Sleeper. Falling back to the id keeps the
    // operator-facing list readable instead of showing a blank row.
    name: raw.name?.trim() || `Sleeper league ${raw.league_id}`,
    season: raw.season?.trim() || null,
    teamCount: typeof raw.total_rosters === 'number' ? raw.total_rosters : null,
  })
}

export function mapTeams(
  rosters: readonly SleeperRosterRaw[],
  users: readonly SleeperUserRaw[],
): Result<readonly ExternalTeam[], ProviderError> {
  const nameByUser = new Map(
    users.filter((u) => u.user_id).map((u) => [u.user_id!, managerDisplayName(u)]),
  )

  const teams: ExternalTeam[] = []
  for (const r of rosters) {
    if (typeof r.roster_id !== 'number') {
      return err(providerError('MALFORMED', 'Sleeper returned a roster with no roster_id.'))
    }
    teams.push({
      externalTeamId: String(r.roster_id),
      // ⚠ owner_id IS NULL FOR AN UNCLAIMED ROSTER, WHICH IS NORMAL.
      // Orphan teams exist in most leagues — a co-manager left, a slot was
      // never filled. Treating null as malformed would refuse to sync a league
      // for being ordinary.
      name: (r.owner_id && nameByUser.get(r.owner_id)) || `Team ${r.roster_id}`,
      externalManagerId: r.owner_id ?? null,
    })
  }
  return ok(teams)
}

export function mapManagers(
  users: readonly SleeperUserRaw[],
): Result<readonly ExternalManager[], ProviderError> {
  const managers: ExternalManager[] = []
  for (const u of users) {
    if (!u.user_id) {
      return err(providerError('MALFORMED', 'Sleeper returned a user with no user_id.'))
    }
    managers.push({
      externalManagerId: u.user_id,
      displayName: managerDisplayName(u) ?? u.user_id,
      // 🛑 ALWAYS NULL. Sleeper does not expose manager emails — which is why
      // ExternalManager.email is nullable at all. A reconciler that keys on
      // email would silently drop every manager on the first platform this
      // phase integrates.
      email: null,
    })
  }
  return ok(managers)
}

// ─── The adapter ─────────────────────────────────────────────────────────────

export function createSleeperProvider(http: SleeperHttp): Provider {
  const asArray = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null)

  return {
    key: SLEEPER_PROVIDER_KEY,
    capabilities: {
      // Sleeper's league endpoints return everything at once. Claiming
      // incremental support would make every sync silently full while the
      // cursor machinery pretended otherwise.
      incremental: false,
      // Sleeper's read API is public. A binding may carry a secretRef for other
      // reasons, but connect() does not need one — and requiring it would block
      // the one provider this phase is built on.
      requiresCredential: false,
      providesManagerEmail: false,
    },

    async connect(externalLeagueId, _ctx: ProviderContext) {
      const res = await http(`/league/${encodeURIComponent(externalLeagueId)}`)
      if (!res.ok) return err(res.error)
      // ⚠ SLEEPER ANSWERS AN UNKNOWN LEAGUE WITH `null` AND A 200, NOT A 404.
      // Without this branch a typo'd id becomes a MALFORMED parse failure, and
      // the operator is told our integration is broken rather than that their
      // id is wrong.
      if (res.value === null) {
        return err(providerError('NOT_FOUND', `Sleeper has no league ${externalLeagueId}.`))
      }
      return mapLeague(res.value as SleeperLeagueRaw)
    },

    async fetchTeams(
      externalLeagueId,
      _ctx,
    ): Promise<Result<ProviderPage<ExternalTeam>, ProviderError>> {
      const id = encodeURIComponent(externalLeagueId)
      const [rostersRes, usersRes] = await Promise.all([
        http(`/league/${id}/rosters`),
        http(`/league/${id}/users`),
      ])
      if (!rostersRes.ok) return err(rostersRes.error)
      if (!usersRes.ok) return err(usersRes.error)

      const rosters = asArray(rostersRes.value)
      const users = asArray(usersRes.value)
      if (!rosters) return err(providerError('MALFORMED', 'Sleeper rosters response was not a list.'))
      if (!users) return err(providerError('MALFORMED', 'Sleeper users response was not a list.'))

      const teams = mapTeams(rosters as SleeperRosterRaw[], users as SleeperUserRaw[])
      if (!teams.ok) return err(teams.error)
      // Never paged — capabilities.incremental is false, so the cursor stays
      // null rather than inventing one nothing will honour.
      return ok({ items: teams.value, nextCursor: null })
    },

    async fetchManagers(
      externalLeagueId,
      _ctx,
    ): Promise<Result<ProviderPage<ExternalManager>, ProviderError>> {
      const res = await http(`/league/${encodeURIComponent(externalLeagueId)}/users`)
      if (!res.ok) return err(res.error)
      const users = asArray(res.value)
      if (!users) return err(providerError('MALFORMED', 'Sleeper users response was not a list.'))
      const managers = mapManagers(users as SleeperUserRaw[])
      if (!managers.ok) return err(managers.error)
      return ok({ items: managers.value, nextCursor: null })
    },
  }
}

// ─── Reconnect idempotency ───────────────────────────────────────────────────

export type ExistingBinding = {
  readonly id: string
  readonly provider: string
  readonly externalLeagueId: string
  readonly leagueId: string
  readonly deletedAt: Date | null
}

export type ConnectPlan =
  | { readonly kind: 'create'; readonly reason: string }
  | { readonly kind: 'reuse'; readonly bindingId: string; readonly reason: string }
  | { readonly kind: 'revive'; readonly bindingId: string; readonly reason: string }
  | { readonly kind: 'conflict'; readonly bindingId: string; readonly reason: string }

/**
 * What connecting should do, given what already exists.
 *
 * 🛑 T-202's ACCEPTANCE: "Reconnecting is idempotent: running sync twice
 * produces no duplicate rows AND NO SPURIOUS AUDIT ENTRIES."
 *
 * The second half is the one that gets missed. A connect implemented as an
 * upsert produces no duplicate row and still writes an audit entry every time —
 * so an operator polling their own reconnect endpoint fills their audit trail
 * with events describing nothing changing, and the trail becomes unreadable
 * exactly when someone needs to find a real change in it.
 *
 * So `reuse` is a distinct outcome from `create`, and returning the decision as
 * DATA rather than performing the write is what lets a test assert that nothing
 * was audited.
 */
export function planConnect(
  existing: readonly ExistingBinding[],
  request: { provider: string; externalLeagueId: string; leagueId: string },
): ConnectPlan {
  const match = existing.find(
    (b) => b.provider === request.provider && b.externalLeagueId === request.externalLeagueId,
  )

  if (!match) return { kind: 'create', reason: 'No binding exists for this provider and league.' }

  if (match.deletedAt !== null) {
    // The partial unique index permits this: it covers live rows only, so a
    // disconnected league can be reconnected. Reviving beats creating — a new
    // row would orphan the old one's sync history.
    return {
      kind: 'revive',
      bindingId: match.id,
      reason: 'A soft-deleted binding exists; reviving it keeps its sync history.',
    }
  }

  if (match.leagueId !== request.leagueId) {
    // The same external league already bound to a DIFFERENT one of our leagues.
    // Silently repointing it would move a live integration under someone's feet.
    return {
      kind: 'conflict',
      bindingId: match.id,
      reason: 'That Sleeper league is already connected to a different league in this tenant.',
    }
  }

  return {
    kind: 'reuse',
    bindingId: match.id,
    reason: 'Already connected. Nothing changed, so nothing is written and nothing is audited.',
  }
}

/** Only a plan that actually changes something is worth an audit row. */
export function planShouldAudit(plan: ConnectPlan): boolean {
  return plan.kind === 'create' || plan.kind === 'revive'
}
