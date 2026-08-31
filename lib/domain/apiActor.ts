/**
 * Commissioner OS · the actor context for an API-key request. T-112.
 *
 * ─── THE DECISION THE TICKET ASKS FOR ────────────────────────────────────────
 * "An API-key request has no `userId`. Either the matrix gains a scope
 * dimension or keys carry a `TenantRole` — decide and implement, because today
 * `scopes` is enforced by nothing."
 *
 * 🛑 THE ANSWER IS BOTH, AS AN INTERSECTION. The "either/or" is a false choice:
 * the two answer different questions.
 *
 *   the ROLE   — what may this principal do AT ALL
 *   the SCOPES — what did the issuer DELEGATE to this particular key
 *
 * Take only scopes and a key can outlive its issuer's authority: an admin
 * issues a key with `leagues:write`, is demoted to support the following week,
 * and the key keeps writing. Nothing revokes it, because nothing connects the
 * two.
 *
 * Take only a role and `scopes` stays a column enforced by nothing — which is
 * precisely the state this ticket exists to end. Worse, it removes the ability
 * to issue a narrow key at all: a CI job that only reads standings would have
 * to hold TENANT_ADMIN, so a leaked build secret is a write credential.
 *
 * Requiring both means a key exceeds neither. It is also the cheaper failure to
 * reason about: to widen a key you must widen the scopes AND hold the role, and
 * both are visible in one row.
 *
 * ─── AND IT HAS NO userId, SO IT GETS A SYNTHETIC ONE ────────────────────────
 * `ActorContext.userId` is required and non-empty (T-003), deliberately — an
 * unattributable audit row is the one thing the audit trail cannot recover
 * from. So an API request is attributed to the KEY: `apikey:<keyId>`, with the
 * key's label as the actor label.
 *
 * That is the same shape as `integration:<provider>` from T-203's synthetic
 * actor, and for the same reason: the audit trail should say "CI deploy key"
 * rather than "unknown", and it should be obvious at a glance that no human was
 * present.
 */

import { type ActorContext, createActorContext } from './actorContext'
import type { DomainError } from './errors'
import type { Result } from './result'
import type { TenantRole } from './roles'

/** The prefix that marks a synthetic API actor. */
export const API_ACTOR_PREFIX = 'apikey:'

export type VerifiedKeyIdentity = {
  readonly tenantId: string
  readonly keyId: string
  readonly label: string
  readonly role: TenantRole
  readonly scopes: readonly string[]
}

/**
 * Build the actor context for a request authenticated by an API key.
 *
 * ⚠ `apiScopes` IS ALWAYS SET, EVEN WHEN EMPTY. `undefined` means "a human
 * session" and skips the scope check entirely; `[]` means "this key was
 * delegated nothing". Passing `undefined` here for a key with no scopes would
 * hand it everything its role allows — the exact inversion of what an empty
 * scope list means.
 */
export function apiActorContext(
  key: VerifiedKeyIdentity,
  options: { requestId?: string; reason?: string } = {},
): Result<ActorContext, DomainError> {
  return createActorContext({
    userId: `${API_ACTOR_PREFIX}${key.keyId}`,
    // The key's label, so the audit trail reads "CI deploy key" rather than an
    // opaque id. Falls back to the id rather than to a blank, which
    // createActorContext would reject anyway.
    actorLabel: key.label || `API key ${key.keyId}`,
    tenantId: key.tenantId,
    // No platform role, ever. Platform authority belongs to people holding a
    // PlatformGrant; an API key is a tenant's credential and must never be a
    // route to cross-tenant access.
    platformRole: null,
    tenantRole: key.role,
    // No league role. A key acts for the operator, not as a member of one of
    // their customers' leagues — league-scoped actions reach it through the
    // tenant axis or not at all.
    leagueRole: null,
    apiScopes: key.scopes,
    ...(options.requestId ? { requestId: options.requestId } : {}),
    ...(options.reason ? { reason: options.reason } : {}),
  })
}

/** Is this context an API key rather than a person? */
export function isApiActor(ctx: ActorContext): boolean {
  return ctx.userId.startsWith(API_ACTOR_PREFIX)
}

/**
 * The key id behind an API actor, or null for a human.
 *
 * Used when revoking: "which key made this call" is answerable from an audit
 * row without joining anything, because the id is in the actor.
 */
export function apiKeyIdOf(ctx: ActorContext): string | null {
  return isApiActor(ctx) ? ctx.userId.slice(API_ACTOR_PREFIX.length) : null
}
