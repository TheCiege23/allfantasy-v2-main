/**
 * The one answer to "is this user a paying AF Commissioner?".
 *
 * Several surfaces asked it differently and disagreed:
 *  - `isAfCommissioner()` in lib/auth/admin.ts is the TEST-ACCOUNT ALLOWLIST, not a plan check. The
 *    playoff challenge used it, so a real subscriber's AF Commissioner pool options were dropped at
 *    create and hidden on every view.
 *  - The Survivor app read the flag off a field the season payload never carries, so its paid
 *    commissioner tools stayed locked for everyone.
 *  - Two routes kept private copies of the resolver call.
 *
 * This resolves the user's real plans (Stripe subscriptions + admin grants, dev-admin bypass
 * included) through EntitlementResolver — the same answer `/api/league/settings` reports to the
 * client as `hasAfCommissionerSub`. Every AF Commissioner feature id maps to the same plan family
 * (commissioner, supreme, enterprise), so the feature id below names the plan, not one feature.
 *
 * Never throws: an unreadable subscription table reads as "not paying", which locks a paid option
 * rather than granting one.
 */
import { isAfCommissioner, type AllFantasyEntitlementUser } from '@/lib/auth/admin'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'

const AF_COMMISSIONER_FEATURE = 'commissioner_ai_tools' as const

/**
 * Pass the whole user when you have it: the test-account allowlist (which also matches on
 * username) keeps working for AllFantasy's own accounts, ON TOP of the real plan check rather than
 * instead of it.
 */
export async function hasAfCommissionerPlan(
  user: (AllFantasyEntitlementUser & { id?: string | null }) | null | undefined,
): Promise<boolean> {
  if (!user?.id) return false
  if (isAfCommissioner(user)) return true
  try {
    const r = await new EntitlementResolver().resolveForUser(user.id, AF_COMMISSIONER_FEATURE, user.email ?? null)
    return Boolean(r.hasAccess)
  } catch {
    return false
  }
}

/** For client gates that read `useEntitlement().hasAccess(...)`: the same feature id. */
export const AF_COMMISSIONER_PLAN_FEATURE = AF_COMMISSIONER_FEATURE
