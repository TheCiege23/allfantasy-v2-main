'use client'

import { useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { useEntitlements } from '@/hooks/useEntitlements'
import { canAccess, type CanAccessResult } from '@/lib/access/canAccess'
import type { SubscriptionFeatureId, SubscriptionPlanId } from '@/lib/subscription/types'

export type UseCanAccessResult = CanAccessResult & { loading: boolean }

/**
 * Client-side wrapper over the single `canAccess` seam (AF_GATE0 §3.4). Assembles the
 * entitlement context from the live session + entitlements snapshot so any gated client
 * surface (including the trial-mode locked previews) has ONE call:
 *
 *   const gate = useCanAccess('trade_finder', pathname)
 *   if (gate.locked) return <LockedPreview ctaLabel={gate.ctaLabel} href={gate.ctaHref} />
 *
 * For a guest/trial visitor this resolves to `requires-signup` (a "Sign up free" CTA);
 * for a signed-in free user, `requires-upgrade`.
 */
export function useCanAccess(feature: SubscriptionFeatureId, returnTo?: string): UseCanAccessResult {
  const { status } = useSession()
  const { snapshot, loading } = useEntitlements()

  return useMemo(() => {
    const isAuthenticated = status === 'authenticated'
    const result = canAccess(feature, {
      isAuthenticated,
      plans: (snapshot?.plans ?? []) as SubscriptionPlanId[],
      status: snapshot?.status,
      returnTo,
    })
    return {
      ...result,
      loading: status === 'loading' || (isAuthenticated && loading),
    }
  }, [feature, returnTo, status, snapshot, loading])
}
