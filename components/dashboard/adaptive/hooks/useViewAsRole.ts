'use client'

import { useState } from 'react'
import type { EntitlementsState } from '@/hooks/useEntitlements'
import type { UseAccessTierResult } from '@/hooks/useAccessTier'

/**
 * The dashboard's effective role: plan tier × commissioner status.
 *
 * In production this is derived entirely from REAL subscription state — `useAccessTier` for
 * paid/free and the user's own league rows for the commissioner flag. The "View As" override
 * exists only so the design can be reviewed in every state without six test accounts, and it
 * is compiled out of production (see `VIEW_AS_ENABLED`).
 */

export type PlanTier = 'free' | 'pro' | 'token'
export type ViewAsRole =
  | 'free-manager' | 'pro-manager' | 'token-manager'
  | 'commissioner-free' | 'commissioner-pro' | 'commissioner-token'

export type EffectiveRole = {
  planTier: PlanTier
  isCommissioner: boolean
  /** Stable key for persisting per-role layout. */
  roleKey: string
  /** Pro-or-better: unlocks the analytics cards. */
  hasPro: boolean
  /** Has a token balance to spend on token tools. */
  hasTokens: boolean
  /** True while the real tier is still loading — callers should avoid flashing locks. */
  loading: boolean
  planLabel: string
  roleLabel: string
}

export const VIEW_AS_OPTIONS: Array<{ id: ViewAsRole; label: string }> = [
  { id: 'free-manager', label: 'Free Manager' },
  { id: 'pro-manager', label: 'Pro Manager' },
  { id: 'token-manager', label: 'Token Manager' },
  { id: 'commissioner-free', label: 'Commissioner Free' },
  { id: 'commissioner-pro', label: 'Commissioner Pro' },
  { id: 'commissioner-token', label: 'Commissioner Token' },
]

/**
 * Dev-only. `process.env.NODE_ENV` is inlined by Next at build time, so this is a literal
 * `false` in the production bundle — the override branch is dead-code-eliminated and the
 * control never renders. A design-review affordance must never be able to flip a real
 * user's gates, and blur is not a security boundary either way: the server remains the only
 * thing that grants entitlements.
 */
export const VIEW_AS_ENABLED = process.env.NODE_ENV !== 'production'

function roleToState(role: ViewAsRole): { planTier: PlanTier; isCommissioner: boolean } {
  const isCommissioner = role.startsWith('commissioner')
  const planTier: PlanTier = role.endsWith('token') || role === 'token-manager'
    ? 'token'
    : role.endsWith('pro') || role === 'pro-manager'
      ? 'pro'
      : 'free'
  return { planTier, isCommissioner }
}

export function stateToRole(planTier: PlanTier, isCommissioner: boolean): ViewAsRole {
  const suffix = planTier === 'free' ? 'free' : planTier === 'token' ? 'token' : 'pro'
  if (isCommissioner) return `commissioner-${suffix}` as ViewAsRole
  return (suffix === 'free' ? 'free-manager' : suffix === 'token' ? 'token-manager' : 'pro-manager')
}

export function useViewAsRole({
  access, entitlements, tokenBalance, commissionsAnyLeague,
}: {
  access: UseAccessTierResult
  entitlements: EntitlementsState
  tokenBalance: number
  /** True when the user commissions at least one of their real leagues. */
  commissionsAnyLeague: boolean
}): {
  role: EffectiveRole
  override: ViewAsRole | null
  setOverride: (r: ViewAsRole) => void
  enabled: boolean
} {
  const [override, setOverride] = useState<ViewAsRole | null>(null)

  const loading = access.loading || entitlements.loading

  // Real state. `paid` → pro; a paid user holding tokens is still 'pro' for gating purposes,
  // since token tools are additive purchases rather than a separate plan.
  const realPlanTier: PlanTier = access.tier === 'paid' ? 'pro' : 'free'
  const realIsCommissioner = commissionsAnyLeague

  const applied = VIEW_AS_ENABLED && override ? roleToState(override) : {
    planTier: realPlanTier,
    isCommissioner: realIsCommissioner,
  }

  /*
   * Under an active preview override the PREVIEWED tier is the answer — the reviewer's own
   * entitlements are irrelevant to what they're previewing. Otherwise real entitlements
   * decide; `hasSupreme` is checked alongside `hasPro` because it reads the raw plan list
   * rather than the bundle-expanded set.
   */
  const previewing = VIEW_AS_ENABLED && override != null
  const hasPro = previewing
    ? applied.planTier !== 'free'
    : entitlements.hasPro || entitlements.hasSupreme

  return {
    role: {
      planTier: applied.planTier,
      isCommissioner: applied.isCommissioner,
      roleKey: `${applied.planTier}-${applied.isCommissioner ? 'c' : 'm'}`,
      hasPro,
      hasTokens: tokenBalance > 0,
      loading,
      planLabel: resolvePlanLabel(entitlements, applied.planTier, Boolean(VIEW_AS_ENABLED && override)),
      roleLabel: applied.isCommissioner ? 'Commissioner' : 'Manager',
    },
    override,
    setOverride,
    enabled: VIEW_AS_ENABLED,
  }
}

/**
 * Plan chip copy. Reads the real entitlement plan names so a Supreme subscriber sees
 * "AF Supreme" rather than a generic "Pro" — except under an active preview override,
 * where the chip must reflect the previewed role instead of the reviewer's own plan.
 */
function resolvePlanLabel(e: EntitlementsState, tier: PlanTier, overridden: boolean): string {
  if (overridden) return tier === 'free' ? 'Free' : tier === 'token' ? 'Pro + Tokens' : 'Pro'
  if (e.hasSupreme) return 'AF Supreme'
  if (e.hasWarRoom) return 'AF Legacy'
  if (e.hasCommissioner) return 'AF Commissioner'
  if (e.hasPro) return 'AF Pro'
  return 'Free'
}
