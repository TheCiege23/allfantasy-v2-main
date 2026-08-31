/**
 * Commissioner OS · ActorContext. T-003.
 *
 * Three independent axes, per `CLAUDE.md`: platform (us), tenant (the
 * operator's staff), league (commissioner / manager). They are deliberately not
 * collapsed into one enum — a person can hold none, one, or all three at once,
 * and a single enum forces a precedence order that is wrong for at least one
 * caller.
 *
 * ─── THE ACCEPTANCE CRITERION, AND HOW IT IS ACTUALLY MET ────────────────────
 * "`ActorContext` cannot be constructed without `tenantId` — enforced at the
 * type level, not by convention."
 *
 * A required property alone does not achieve that. `{...} as ActorContext` and
 * `JSON.parse(body) as ActorContext` both compile, and both are what a tired
 * person writes at a route boundary. So `ActorContext` is BRANDED with a
 * non-exported unique symbol: the only expression in the program that produces
 * one is `createActorContext`, because nothing else can supply the brand.
 *
 * The cast still exists — it exists exactly once, in this file, on a value that
 * has just been validated. That is the difference between a type-level
 * guarantee and a convention.
 *
 * `__tests__/commissioner-os/actorContext.types.ts` proves the compile errors
 * with `@ts-expect-error`, and is typechecked as part of verifying this ticket
 * — a `@ts-expect-error` that no compiler ever reads is a check that cannot
 * fail.
 */

import type { LeagueRole, PlatformRole, TenantRole } from './roles'
import { type Result, err, ok } from './result'
import { type DomainError, invariant } from './errors'

declare const ACTOR_CONTEXT_BRAND: unique symbol

/** The data. Not constructible on its own — see `ActorContext`. */
export type ActorContextFields = {
  readonly userId: string
  /**
   * Denormalised display name, captured at request time.
   *
   * ⚠ COPIED, NOT JOINED, AND THAT IS THE POINT. Audit rows carry it so that a
   * trail stays readable after the person is deleted — a join would render
   * "unknown" across years of history the day someone leaves. It also keeps
   * audit reads off `TenantUser`, which is where the PII lives.
   */
  readonly actorLabel: string
  /**
   * ALWAYS present. Drives RLS. There is no such thing as an untenanted actor.
   *
   * 🛑 THIS MUST COME FROM THE SERVER-SIDE SESSION. Never from a request body,
   * query parameter or header — and specifically never from
   * `NEXT_PUBLIC_TENANT_ID`.
   *
   * That variable already exists in this repo and already means "tenant". It
   * belongs to `lib/white-label/`, which resolves a BRAND from it: five source
   * references, all client-side, zero under `app/api`, and its own header says
   * "frontend-only". Being `NEXT_PUBLIC_` it ships in the client bundle, so any
   * viewer can read it and any viewer can change it.
   *
   * The two values are the same concept under the same name — one is branding,
   * one is the security boundary — and they will look interchangeable in a code
   * review. The failure is silent in the worst way: every page renders
   * correctly and cross-tenant reads succeed.
   *
   * ⚠ `resolveTenantBrand(tenantId?: string)` is the sharpest edge: it takes a
   * caller-supplied id that overrides the env var and falls back to a default
   * for an unknown one, so it never fails. It is exactly what someone reaches
   * for when wiring this field, and it would return a brand config while
   * looking like it resolved an identity.
   *
   * Nothing in `lib/domain/` may import from `lib/white-label/`. See
   * `docs/commissioner-os/TENANCY.md` §3.8.
   */
  readonly tenantId: string
  readonly platformRole: PlatformRole | null
  readonly tenantRole: TenantRole | null
  readonly leagueRole: LeagueRole | null
  /**
   * Act-as, never session takeover.
   *
   * ⚠ The actor keeps their OWN `userId` while this is set. Impersonation that
   * rewrites the actor is banned outright: an audit row must never appear to
   * have been written by someone who did not write it. This field records that
   * the action was taken on a league's behalf; it does not change who took it.
   */
  readonly onBehalfOfLeagueId?: string
  readonly reason?: string
  /**
   * The scopes delegated to the API key this request authenticated with. T-112.
   *
   * ⚠ `undefined` MEANS "A HUMAN SESSION", NOT "NO SCOPES". The distinction is
   * load-bearing: `undefined` skips the scope check entirely, while `[]` is a
   * key that was delegated nothing and can do nothing. Collapsing the two —
   * defaulting to `[]` — would lock every human out; defaulting the other way
   * would make every key unscoped.
   */
  readonly apiScopes?: readonly string[]
  /** Correlates audit rows, logs and domain events for one request. */
  readonly requestId: string
}

/**
 * A validated actor context.
 *
 * Only `createActorContext` can produce one. The brand is not exported as a
 * value, so no cast outside this module can satisfy it.
 */
export type ActorContext = ActorContextFields & {
  readonly [ACTOR_CONTEXT_BRAND]: true
}

/** What a caller supplies. Note `tenantId` is required, so omitting it is a compile error. */
export type ActorContextInput = {
  readonly userId: string
  readonly actorLabel: string
  readonly tenantId: string
  readonly platformRole?: PlatformRole | null
  readonly tenantRole?: TenantRole | null
  readonly leagueRole?: LeagueRole | null
  readonly onBehalfOfLeagueId?: string
  readonly reason?: string
  readonly apiScopes?: readonly string[]
  readonly requestId?: string
}

/**
 * Build a context, validating the fields a type cannot.
 *
 * The type system guarantees `tenantId` is PRESENT. It cannot guarantee the
 * string is non-empty, and an empty one is the dangerous case: `withTenant`
 * would write `''` into `app.tenant_id`, TENANCY.md §3.2's `nullif(…, '')`
 * guard would match NOTHING, and the operator sees an empty database rather
 * than an error. So presence is checked by the compiler and emptiness here.
 */
export function createActorContext(input: ActorContextInput): Result<ActorContext, DomainError> {
  const missing = (['userId', 'actorLabel', 'tenantId'] as const).filter(
    (k) => !input[k] || input[k].trim() === '',
  )

  if (missing.length > 0) {
    return err(
      invariant(
        'actorContext.required',
        `ActorContext requires non-empty ${missing.join(', ')}.` +
          (missing.includes('tenantId')
            ? ' An empty tenantId matches no rows under RLS, which presents as an empty database rather than an error.'
            : ''),
      ),
    )
  }

  const fields: ActorContextFields = {
    userId: input.userId,
    actorLabel: input.actorLabel,
    tenantId: input.tenantId,
    platformRole: input.platformRole ?? null,
    tenantRole: input.tenantRole ?? null,
    leagueRole: input.leagueRole ?? null,
    ...(input.onBehalfOfLeagueId ? { onBehalfOfLeagueId: input.onBehalfOfLeagueId } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    // Spread only when defined — see the note on the field. `undefined` and
    // `[]` mean different things and must not be flattened into each other.
    ...(input.apiScopes === undefined ? {} : { apiScopes: input.apiScopes }),
    requestId: input.requestId?.trim() || newRequestId(),
  }

  // The one cast in the program that mints an ActorContext, on a value that has
  // just been validated. Everything above exists to make this line safe.
  return ok(fields as ActorContext)
}

/**
 * Build a context from an inbound request plus already-resolved identity.
 *
 * ⚠ IDENTITY IS A PARAMETER, NOT SOMETHING THIS READS OFF THE REQUEST.
 * Resolving who the caller is means a session lookup or an API-key lookup, and
 * both are database reads that run BEFORE `tenantId` is known — which is
 * exactly what TENANCY.md §3.6's `SECURITY DEFINER` bootstrap functions are
 * for. Those land at T-102. Taking identity as an argument keeps this builder
 * honest in the meantime instead of growing a temporary lookup that outlives
 * its excuse.
 *
 * Only two things genuinely come off the wire:
 *
 * - `x-request-id`, so a trace survives the hop from a proxy. Generated when
 *   absent — never blank, because a blank one silently un-correlates a request's
 *   audit rows from its logs.
 * - `x-commish-reason`, the operator's stated reason for a reason-required
 *   action. Carried, NOT validated here: T-004 owns the rules (>= 12 chars, not
 *   the action name, not in the stoplist) and duplicating them would give two
 *   answers to one question.
 *
 * `onBehalfOfLeagueId` is deliberately NOT read from a header. Act-as is a
 * privilege, and a privilege that can be asserted by adding a header to a
 * request is not a privilege. It arrives through `identity`, where whatever
 * granted it can be audited.
 */
export function actorContextFromRequest(
  request: { headers: { get(name: string): string | null } },
  identity: Omit<ActorContextInput, 'requestId' | 'reason'>,
): Result<ActorContext, DomainError> {
  const headerReason = request.headers.get('x-commish-reason')
  return createActorContext({
    ...identity,
    requestId: request.headers.get('x-request-id') ?? undefined,
    ...(headerReason ? { reason: headerReason } : {}),
  })
}

/**
 * ⚠ `crypto.randomUUID` is not universally present — it needs Node 19+, or a
 * secure context in a browser. A throw here would turn "no x-request-id header"
 * into a 500, so the fallback is unconditional rather than clever. It is a
 * correlation id, not a secret; uniqueness within a log window is the whole
 * requirement.
 */
function newRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * The synthetic actor for provider sync (T-203).
 *
 * Declared here rather than invented at each integration so that `cause: SYNC`
 * rows are distinguishable from human writes by construction. It carries NO
 * roles at all — `CLAUDE.md`: "a provider can never trigger an action the matrix
 * would deny a human", and the cheapest way to hold that is to give integration
 * strictly less authority than any person, not equal authority under a
 * different name.
 */
export function syntheticIntegrationActor(
  tenantId: string,
  provider: string,
  requestId?: string,
): Result<ActorContext, DomainError> {
  return createActorContext({
    userId: `integration:${provider}`,
    actorLabel: `${provider} sync`,
    tenantId,
    platformRole: null,
    tenantRole: null,
    leagueRole: null,
    ...(requestId ? { requestId } : {}),
  })
}
