/**
 * Commissioner OS · three-axis authorization. T-104.
 *
 * One function reading one matrix: `authorize(ctx, action, resource)`. No role
 * checks scattered in route handlers — `CLAUDE.md` is explicit, and the reason
 * is that a scattered check is invisible to review and untestable as a set.
 *
 * ─── WHY A `Record<ActionKey, ActionRule>` AND NOT A LOOKUP FUNCTION ─────────
 * "`ActionKey` is exhaustive so a missing row is a compile error." A `Record`
 * keyed on a union is the only shape TypeScript enforces that on: adding a
 * variant to `ActionKey` without adding a row fails to compile, here, at the
 * definition. A `Map`, a lookup with a default, or `Partial<Record<…>>` would
 * each accept the omission and fail at runtime — as a refusal, which reads
 * exactly like a correct denial.
 *
 * ─── THE THREE AXES DO NOT COLLAPSE ──────────────────────────────────────────
 * A person can hold none, one, or all three. `CLAUDE.md` says do not collapse
 * them into one enum, and the matrix respects that: a rule grants per axis, and
 * holding ANY granting role on ANY axis is sufficient. There is deliberately no
 * precedence order, because any order would be wrong for somebody — a
 * commissioner who also works for the operator is not "really" one or the other.
 *
 * ─── TENANCY.md §6, APPLIED ──────────────────────────────────────────────────
 * "Most actions currently platform-admin-only become tenant-admin actions
 * scoped to that tenant's leagues — an operator must run their own business
 * without calling us." So the platform keeps four actions and no more:
 * provisioning, suspension, plan changes, cross-tenant reads.
 */

import type { ActorContext } from './actorContext'
import { type DomainError, forbidden } from './errors'
import type { LeagueRole, PlatformRole, TenantRole } from './roles'
import { type Result, err, ok } from './result'
import type { Authorize } from './ports'

// ─── The action vocabulary ───────────────────────────────────────────────────

/**
 * 🛑 A RUNTIME ARRAY, WITH `ActionKey` DERIVED FROM IT — NOT A HAND-WRITTEN
 * UNION.
 *
 * The union came first, and a positive control caught it being insufficient:
 * widening `PERMISSION_MATRIX` to `Record<string, ActionRule>` still
 * typechecked clean, because the type-level fixture declared its OWN
 * `Record<ActionKey, ActionRule>` and never checked how the REAL matrix was
 * annotated. The exhaustiveness guarantee was proved about TypeScript rather
 * than about this file.
 *
 * With the keys as data, `authorize.test.ts` compares `Object.keys(matrix)`
 * against this array — so a missing row fails at RUNTIME too, whatever the
 * annotation says. The type still makes it a compile error; this makes the
 * compile error un-bypassable.
 */
export const ACTION_KEYS = [
  // Platform-only. TENANCY.md §6: "Platform keeps: tenant provisioning,
  // suspension, plan changes, cross-tenant reads." Nothing else belongs here.
  'tenant.provision',
  'tenant.suspend',
  'tenant.changePlan',
  'tenant.crossTenantRead',
  // The operator running their own business.
  'tenant.delete',
  'tenant.member.invite',
  'tenant.member.changeRole',
  'tenant.member.remove',
  'tenant.apiKey.issue',
  'tenant.apiKey.revoke',
  'tenant.webhook.configure',
  'tenant.export',
  // Inside one league.
  'league.settings.update',
  'league.phase.advance',
  'league.sync.reconcile',
  'league.sync.read',
  'audit.read',
  'analytics.read',
  'data.readDeleted',
  'data.purgeLeague',
] as const

export type ActionKey = (typeof ACTION_KEYS)[number]

export type ActionScope = 'platform' | 'tenant' | 'league'

export type ActionRule = {
  /**
   * Whether this action mutates. Drives the T-104 acceptance test that
   * `TENANT_SUPPORT` holds no write action at all — asserted over the whole
   * matrix rather than per action, because the property is about the ROLE and a
   * per-action test would miss the row someone adds later.
   */
  readonly write: boolean
  readonly scope: ActionScope
  readonly platform?: readonly PlatformRole[]
  readonly tenant?: readonly TenantRole[]
  readonly league?: readonly LeagueRole[]
  /** Enforced by the mutation wrapper (T-004) and `withDeleted` (T-006). */
  readonly reasonRequired?: boolean
  /**
   * The API scope a key must hold to take this action. T-112.
   *
   * ⚠ ABSENT MEANS "NOT REACHABLE BY AN API KEY AT ALL", NOT "NO SCOPE
   * NEEDED". An action added next year without thinking about API access is
   * therefore closed to keys until someone decides otherwise — the opposite of
   * the default that would let a new destructive action be reachable by every
   * existing key the moment it ships.
   */
  readonly apiScope?: ApiScope
}

/**
 * What a key can be delegated.
 *
 * Coarser than `ActionKey` on purpose: a scope is chosen by a human issuing a
 * key in a UI, and a list of eighteen actions is not a choice anyone makes
 * well. Grouping them means an issuer picks "read leagues" rather than ticking
 * boxes they will not read.
 */
export const API_SCOPES = [
  // ⚠ NO `leagues:read` OR `members:read` — DELIBERATELY ABSENT, NOT FORGOTTEN.
  // Both were declared here and removed the same hour: a test asserts every
  // scope is used by at least one action, and neither was, because the matrix
  // has no plain league-read or member-read action. A scope nothing uses reads
  // as delegation to whoever ticks it and delegates nothing.
  //
  // When a league-read action lands, its scope arrives with it — in the same
  // change, so the two cannot drift apart again.
  'leagues:write',
  'members:write',
  'keys:write',
  'webhooks:write',
  'audit:read',
  'analytics:read',
  'export:read',
  // Arrives WITH `league.sync.read`, in the same change, exactly as the note
  // above asks. The two removed scopes were removed for being unused; this one
  // is used by the action added in this commit, and the "every scope is used by
  // at least one action" test is what keeps that honest.
  //
  // ⚠ A READ SCOPE, AND THERE IS NO `sync:write` COUNTERPART. Reconcile is
  // deliberately closed to API keys — an operator's key must not be able to
  // drive provider-shaped data into a league — so a write scope here would have
  // no action to attach to and would read as delegable when it is not.
  'sync:read',
] as const

export type ApiScope = (typeof API_SCOPES)[number]

const OWNER_ADMIN = ['TENANT_OWNER', 'TENANT_ADMIN'] as const
const COMMISH = ['COMMISSIONER', 'CO_COMMISSIONER'] as const

/**
 * 🛑 EXHAUSTIVE BY CONSTRUCTION. Adding an `ActionKey` without a row here is a
 * compile error, which is the point — a missing row that failed at runtime
 * would present as a refusal, and a refusal is indistinguishable from the
 * matrix working correctly.
 */
export const PERMISSION_MATRIX: Record<ActionKey, ActionRule> = {
  // ── Platform. Four actions, deliberately.
  'tenant.provision': { write: true, scope: 'platform', platform: ['PLATFORM_ADMIN'] },
  'tenant.suspend': {
    write: true,
    scope: 'platform',
    platform: ['PLATFORM_ADMIN'],
    // Suspension takes an operator's business read-only. Whoever does it says why.
    reasonRequired: true,
  },
  'tenant.changePlan': { write: true, scope: 'platform', platform: ['PLATFORM_ADMIN'] },
  'tenant.crossTenantRead': {
    write: false,
    scope: 'platform',
    platform: ['PLATFORM_ADMIN', 'PLATFORM_SUPPORT'],
    // TENANCY.md §7: every use is audited, reason required, and marks the
    // resulting rows isPlatformRead so the operator can see it happened.
    reasonRequired: true,
  },

  // ── The operator's own business.
  'tenant.delete': {
    write: true,
    scope: 'tenant',
    // OWNER only. `CLAUDE.md`: "TENANT_OWNER — billing + can delete the tenant".
    // Not TENANT_ADMIN: an admin runs the business, they do not end it.
    tenant: ['TENANT_OWNER'],
    reasonRequired: true,
  },
  'tenant.member.invite': { write: true, scope: 'tenant', tenant: [...OWNER_ADMIN], apiScope: 'members:write' },
  'tenant.member.changeRole': {
    write: true,
    scope: 'tenant',
    // OWNER only: an ADMIN who can change roles can promote themselves to
    // OWNER, which makes the distinction between the two decorative.
    tenant: ['TENANT_OWNER'],
    apiScope: 'members:write',
  },
  'tenant.member.remove': { write: true, scope: 'tenant', tenant: [...OWNER_ADMIN], apiScope: 'members:write' },
  'tenant.apiKey.issue': { write: true, scope: 'tenant', tenant: [...OWNER_ADMIN], apiScope: 'keys:write' },
  'tenant.apiKey.revoke': { write: true, scope: 'tenant', tenant: [...OWNER_ADMIN], apiScope: 'keys:write' },
  'tenant.webhook.configure': { write: true, scope: 'tenant', tenant: [...OWNER_ADMIN], apiScope: 'webhooks:write' },
  'tenant.export': {
    write: false,
    scope: 'tenant',
    tenant: [...OWNER_ADMIN],
    // T-107. A read, but a read of everything — the whole tenant, leaving.
    reasonRequired: true,
    apiScope: 'export:read',
  },

  // ── Inside one league. Note every one is reachable by the operator's own
  //    admins: §6's "an operator must run their own business without calling us".
  'league.settings.update': {
    write: true,
    scope: 'league',
    tenant: [...OWNER_ADMIN],
    league: [...COMMISH],
    apiScope: 'leagues:write',
  },
  'league.phase.advance': {
    write: true,
    scope: 'league',
    tenant: [...OWNER_ADMIN],
    league: [...COMMISH],
    apiScope: 'leagues:write',
  },
  // T-203. The ONE action provider sync may take.
  //
  // 🛑 IT IS GRANTABLE TO A COMMISSIONER, AND THAT IS THE INVARIANT.
  // HANDOFF.md: "A provider can never trigger an action the matrix would deny a
  // commissioner." That is only checkable if every action sync may take is one
  // a commissioner holds — `reconcile.test.ts` asserts exactly that over
  // SYNC_PERMITTED_ACTIONS rather than trusting this comment.
  //
  // ⚠ NO `apiScope`, so it is closed to API keys. Sync is driven by our own
  // scheduler with a synthetic actor; an operator's key must not be able to
  // trigger a reconcile with provider-shaped data of its own choosing.
  'league.sync.reconcile': {
    write: true,
    scope: 'league',
    tenant: [...OWNER_ADMIN],
    league: [...COMMISH],
  },
  // Reading the sync health of a league's provider bindings. Added when
  // /api/commissioner-os/sync-health became the first request path through
  // withTenant — a new capability gets a matrix row, which is what makes the
  // ActionKey union turn a missing one into a compile error rather than an
  // ungoverned read.
  //
  // ⚠ WIDER THAN league.sync.reconcile ON PURPOSE, and the pairing is the point.
  // Reconcile WRITES provider data into a league and is closed to API keys
  // entirely; this only reports whether sync is stale. TENANT_SUPPORT is exactly
  // the role that gets asked "why is this league's data old?" and must be able
  // to answer without holding the ability to trigger a sync.
  'league.sync.read': {
    write: false,
    scope: 'league',
    tenant: ['TENANT_OWNER', 'TENANT_ADMIN', 'TENANT_SUPPORT'],
    league: [...COMMISH],
    apiScope: 'sync:read',
  },
  'audit.read': {
    write: false,
    scope: 'league',
    // TENANT_SUPPORT belongs here: it is read-only staff, and reading the audit
    // trail is most of what support does. §6 says audit.read "gains a tenant
    // scope between platform and league" — this is that.
    tenant: ['TENANT_OWNER', 'TENANT_ADMIN', 'TENANT_SUPPORT'],
    league: [...COMMISH],
    apiScope: 'audit:read',
  },
  'analytics.read': {
    write: false,
    scope: 'league',
    tenant: ['TENANT_OWNER', 'TENANT_ADMIN', 'TENANT_SUPPORT'],
    league: ['COMMISSIONER', 'CO_COMMISSIONER', 'MANAGER'],
    apiScope: 'analytics:read',
  },
  'data.readDeleted': {
    write: false,
    scope: 'league',
    // T-006: "platform and tenant-support only". A commissioner does not get to
    // read what was deleted from their own league — that is a support action
    // precisely because it needs someone outside the dispute.
    platform: ['PLATFORM_ADMIN', 'PLATFORM_SUPPORT'],
    tenant: ['TENANT_SUPPORT'],
    reasonRequired: true,
  },
  'data.purgeLeague': {
    write: true,
    scope: 'league',
    // The only irreversible action in the matrix. Platform admin or the
    // operator's owner — never an admin, and never a commissioner.
    platform: ['PLATFORM_ADMIN'],
    tenant: ['TENANT_OWNER'],
    reasonRequired: true,
  },
}

// ─── The function ────────────────────────────────────────────────────────────

/** Anything carrying a tenant, which is what the cross-tenant check needs. */
export type TenantOwned = { tenantId?: string | null }

function grants(ctx: ActorContext, rule: ActionRule): boolean {
  // ANY axis is sufficient, and there is no precedence between them — see the
  // header. A person who is both a commissioner and an operator admin is both.
  if (ctx.platformRole && rule.platform?.includes(ctx.platformRole)) return true
  if (ctx.tenantRole && rule.tenant?.includes(ctx.tenantRole)) return true
  if (ctx.leagueRole && rule.league?.includes(ctx.leagueRole)) return true
  return false
}

/**
 * Does the actor's tenant match the resource's?
 *
 * ⚠ DEFENCE IN DEPTH, NOT THE BOUNDARY. RLS is the boundary (TENANCY.md §1) and
 * would return zero rows for another tenant's league anyway — so in practice
 * `resource` is usually already unreachable. This check exists for the case
 * where it is NOT: a resource loaded through a bootstrap function, a platform
 * connection, or a future code path that has not been written yet.
 *
 * It also produces a better error. Without it the caller gets "not found" from
 * an empty read and goes looking for a deleted league; with it they get a
 * refusal that says what happened.
 */
function sameTenant(ctx: ActorContext, resource: unknown): boolean {
  if (resource === null || typeof resource !== 'object') return true
  const rid = (resource as TenantOwned).tenantId
  if (rid === undefined || rid === null) return true
  return rid === ctx.tenantId
}

/**
 * Build the `Authorize` port from a matrix.
 *
 * Takes the matrix as an argument so a test can assert behaviour against a
 * fixture without depending on every future row, and so the production wiring
 * is a visible line at the composition root rather than an import side effect.
 */
export function createAuthorize(matrix: Record<ActionKey, ActionRule> = PERMISSION_MATRIX): Authorize {
  return <TResource,>(args: {
    ctx: ActorContext
    requires: string
    resource: TResource
  }): Result<void, DomainError> => {
    const rule = (matrix as Record<string, ActionRule | undefined>)[args.requires]

    if (!rule) {
      // Fail closed on an unknown key. The exhaustive Record makes this
      // unreachable from typed call sites — it is here for the untyped ones
      // (an API scope string, a value off the wire) where a typo must be a
      // refusal rather than a silent allow.
      return err(
        forbidden(args.requires, `Unknown action "${args.requires}". Refused rather than allowed.`),
      )
    }

    // Cross-tenant check BEFORE the role check, so a tenant admin poking
    // another tenant's league id gets the same refusal whatever their role —
    // and so the refusal reason cannot be used to probe which roles exist.
    if (!sameTenant(args.ctx, args.resource)) {
      return err(
        forbidden(
          args.requires,
          'That resource belongs to a different tenant.',
        ),
      )
    }

    if (!grants(args.ctx, rule)) {
      return err(forbidden(args.requires))
    }

    // T-112 · the API scope dimension.
    //
    // 🛑 AN INTERSECTION, NOT AN ALTERNATIVE. The ticket offers "either the
    // matrix gains a scope dimension or keys carry a TenantRole"; the answer is
    // both, because they answer different questions:
    //
    //   the ROLE   — what may this principal do at all
    //   the SCOPES — what did the issuer delegate to THIS key
    //
    // Scopes alone would let a key outlive its issuer's authority. A role alone
    // would leave `scopes` enforced by nothing, which is the state T-112 exists
    // to fix. Requiring both means a key can never exceed either.
    //
    // `apiScopes` is undefined for a human session, and the check is skipped —
    // a person's authority is their role, and they hold no delegation.
    if (args.ctx.apiScopes !== undefined) {
      if (!rule.apiScope) {
        return err(
          forbidden(
            args.requires,
            'This action is not available to API keys. It declares no scope, which is a decision rather than an omission.',
          ),
        )
      }
      if (!args.ctx.apiScopes.includes(rule.apiScope)) {
        return err(
          forbidden(args.requires, `This key does not hold the "${rule.apiScope}" scope.`),
        )
      }
    }

    return ok(undefined)
  }
}

/** The production instance. */
export const authorize = createAuthorize()

/** Actions this actor may take. For rendering a UI, never for enforcement. */
export function allowedActions(ctx: ActorContext): ActionKey[] {
  return ACTION_KEYS.filter((key) => grants(ctx, PERMISSION_MATRIX[key]))
}

/** Whether an action needs a reason. Read by T-004's wrapper and T-006's escape. */
export function actionRequiresReason(action: ActionKey): boolean {
  return PERMISSION_MATRIX[action].reasonRequired === true
}
