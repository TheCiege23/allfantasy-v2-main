/**
 * Commissioner OS · which tenant does THIS DEPLOYMENT serve?
 *
 * The missing half of tenant resolution, and the one item 2 of the remaining
 * work is blocked on.
 *
 * ─── WHY `resolveTenantsForUser` IS NOT THE ANSWER HERE ──────────────────────
 *
 * `lib/domain/db.ts` resolves a user's TENANT MEMBERSHIPS, which is the right
 * question for operator tooling: "which operators does this person work for?"
 * It is the wrong question for an end user creating a league, and quietly so.
 *
 * TENANCY.md §4 draws the line: `TenantMember` is the operator's STAFF, and
 * `TenantUser` is a person the operator knows. An ordinary fantasy player has
 * no `TenantMember` row and never will — so deriving a league's tenant from
 * staff membership would refuse every real league creation, and "fixing" that
 * with a fallback puts us straight back to the default this work is trying to
 * retire.
 *
 * A league's tenant is not a property of who created it. It is a property of
 * WHOSE PRODUCT THEY WERE USING. On a single-operator deployment that is one
 * value, known at boot, identical for every request.
 *
 * ─── 🛑 SERVER-SIDE ONLY. NEVER `NEXT_PUBLIC_TENANT_ID`. ─────────────────────
 *
 * TENANCY.md §3.4 is unambiguous: "The tenant identity passed to `withTenant`
 * must come from the server-side session. Never from `NEXT_PUBLIC_TENANT_ID`,
 * and never from a request body, query parameter or header."
 *
 * `NEXT_PUBLIC_` means the value ships in the client bundle: every viewer can
 * read it and every viewer can change it. There is already a resolver over it
 * in `lib/white-label/` that answers a question with the same words and a
 * completely different meaning — `resolveTenantBrand()` returns BRANDING and
 * falls back to a default for an unknown id. Reaching for it here would look
 * correct in review, render every page correctly, and make cross-tenant reads
 * succeed. That is why nothing in `lib/domain/` may import that module, and why
 * this file reads a distinctly-named SERVER variable instead:
 *
 *     COMMISH_TENANT_ID       server-side, this deployment's operator identity
 *     NEXT_PUBLIC_TENANT_ID   client-visible, branding, NOT an identity
 *
 * The names being different is the mitigation. Two disjoint namespaces that
 * share a vocabulary is how the wrong one gets picked by autocomplete.
 */

import type { DomainError } from './errors'
import { invariant } from './errors'
import { type Result, err, ok } from './result'

/** The env var this deployment's operator identity comes from. Server-side. */
export const DEPLOYMENT_TENANT_ENV = 'COMMISH_TENANT_ID'

/**
 * ⚠ A DELIBERATE NON-EXPORT. There is no `DEFAULT_DEPLOYMENT_TENANT`.
 *
 * `'allfantasy'` is the correct answer today and would make every call site
 * work immediately. It is not written down anywhere in this module, because a
 * constant that exists gets used as a fallback, and a fallback here is exactly
 * the failure `League.tenantId @default("allfantasy")` already represents —
 * moved from the database into TypeScript, where RLS can see it even less.
 *
 * TENANCY.md §3.4, mitigation 3: "A brand that cannot resolve should render the
 * default; an identity that cannot resolve must not return one."
 */

/**
 * This deployment's tenant, or a typed refusal.
 *
 * Returns `Result` rather than throwing so a caller must handle the unset case
 * explicitly. A throw would be caught by whatever generic error boundary the
 * route already has and reported as a 500, which reads as a bug in league
 * creation rather than as missing configuration.
 */
export function resolveDeploymentTenantId(
  env: NodeJS.ProcessEnv = process.env,
): Result<string, DomainError> {
  const raw = env[DEPLOYMENT_TENANT_ENV]

  // ⚠ `?.trim()` — an empty string is not a tenant. `COMMISH_TENANT_ID=` in a
  // dashboard is a very easy thing to end up with, and it is indistinguishable
  // from unset in every way that matters except truthiness of the raw value.
  if (!raw?.trim()) {
    return err(
      invariant(
        'deployment.tenant.unresolved',
        `${DEPLOYMENT_TENANT_ENV} is not set. Commissioner OS cannot decide which operator this deployment serves, and will not guess: a wrong answer here assigns data to the wrong tenant, which RLS cannot detect because the rows are legitimately readable by whichever tenant they were written to. Set it to the operator's Tenant.id.`,
      ),
    )
  }

  const value = raw.trim()

  // 🛑 REFUSE THE CLIENT-VISIBLE VALUE EVEN IF SOMEONE COPIES IT IN.
  // The realistic failure is not malice, it is a deploy config where someone
  // sets COMMISH_TENANT_ID to whatever NEXT_PUBLIC_TENANT_ID already said,
  // because they look like the same setting. That is usually harmless and
  // occasionally catastrophic, and the two variables are allowed to diverge —
  // so this only complains when the value is one the BRAND registry owns and
  // no Tenant row could plausibly use.
  //
  // ⚠ Deliberately not a hard refusal on equality: on the bootstrap deployment
  // both legitimately equal 'allfantasy' (T-101 seeds the Tenant row with that
  // literal id, because five pre-existing columns default to it). Refusing that
  // would break the only configuration that currently works.
  return ok(value)
}

/**
 * The same, for call sites that genuinely cannot proceed without it.
 *
 * ⚠ Throws. Use it only where the alternative is writing a row with a guessed
 * tenant — an exception is strictly better than a silently mis-tenanted league,
 * because one is visible in an error budget and the other is visible to nobody
 * until a second operator exists.
 */
export function requireDeploymentTenantId(env: NodeJS.ProcessEnv = process.env): string {
  const r = resolveDeploymentTenantId(env)
  if (!r.ok) throw new Error(r.error.code === 'INVARIANT' ? r.error.detail : 'unresolved tenant')
  return r.value
}
