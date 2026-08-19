'use client'

/**
 * PROMPT 252 — Frontend hook for subscription entitlement. Enforce gating on client.
 * PROMPT 273 — Refetch on window focus (throttled) so subscription state stays in sync when user returns from another tab (e.g. after purchase elsewhere).
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { FOCUS_REFETCH_THROTTLE_MS } from '@/lib/state-consistency/refresh-triggers'
import { POST_PURCHASE_SYNC_EVENT } from '@/lib/state-consistency/post-purchase-sync-events'
import { addStateRefreshListener } from '@/lib/state-consistency/state-events'
import { trackSubscriptionStateViewed } from '@/lib/monetization-analytics'
import type { SubscriptionFeatureId, SubscriptionPlanId } from '@/lib/subscription/types'
import {
  buildFeatureUpgradePath,
  hasFeatureAccessForPlans,
} from '@/lib/subscription/feature-access'

export interface EntitlementState {
  plans: string[]
  status: 'active' | 'grace' | 'past_due' | 'expired' | 'none'
  currentPeriodEnd: string | null
  gracePeriodEnd: string | null
  message: string
  requiredPlan?: string | null
  upgradePath?: string
  bundleInheritance?: {
    hasSupreme: boolean
    inheritedPlanIds: string[]
    effectivePlanIds: string[]
  } | null
}

export interface UseEntitlementResult {
  entitlement: EntitlementState | null
  loading: boolean
  error: string | null
  featureAccess: boolean
  hasAccess: (featureId: SubscriptionFeatureId) => boolean
  isActiveOrGrace: boolean
  upgradePath: string
  /**
   * True when `entitlement` is a synthetic dev-admin grant (lib/dev-admin/access.ts), not a real
   * Stripe subscription. Mirrors useTokenBalance's isAdminBypassAccount — surfaces rendering a
   * plan badge/status off this hook must disclose this rather than show it as an indistinguishable
   * real plan.
   */
  isAdminBypassAccount: boolean
  refetch: () => Promise<void>
}

const ALLOWED_PLAN_IDS = new Set<SubscriptionPlanId>([
  'pro',
  'commissioner',
  'war_room',
  'supreme',
])

function toPlanIds(plans: string[] | undefined): SubscriptionPlanId[] {
  return (plans ?? []).filter((plan): plan is SubscriptionPlanId =>
    ALLOWED_PLAN_IDS.has(plan as SubscriptionPlanId)
  )
}

export function useEntitlement(featureId?: SubscriptionFeatureId): UseEntitlementResult {
  const [entitlement, setEntitlement] = useState<EntitlementState | null>(null)
  const [hasFeatureAccess, setHasFeatureAccess] = useState<boolean | undefined>(undefined)
  const [isAdminBypassAccount, setIsAdminBypassAccount] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const lastFocusRefetch = useRef(0)
  const trackedLifecycleViews = useRef<Set<string>>(new Set())

  const fetchEntitlement = useCallback(async () => {
    setLoading(true)
    try {
      const url = featureId
        ? `/api/subscription/entitlements?feature=${encodeURIComponent(featureId)}`
        : '/api/subscription/entitlements'
      const res = await fetch(url)
      if (!res.ok) {
        setEntitlement(null)
        setHasFeatureAccess(false)
        setIsAdminBypassAccount(false)
        setError(`Failed to load subscription status (${res.status}).`)
        return
      }
      setError(null)
      const data = await res.json()
      setIsAdminBypassAccount(Boolean(data.isAdminBypassAccount))
      if (data.entitlement) {
        setEntitlement({
          plans: data.entitlement.plans ?? [],
          status: data.entitlement.status ?? 'none',
          currentPeriodEnd: data.entitlement.currentPeriodEnd ?? null,
          gracePeriodEnd: data.entitlement.gracePeriodEnd ?? null,
          message: data.message ?? 'Upgrade to access this feature.',
          requiredPlan: data.requiredPlan ?? null,
          upgradePath:
            data.upgradePath ??
            (featureId ? buildFeatureUpgradePath(featureId) : '/pricing'),
          bundleInheritance: data.bundleInheritance ?? null,
        })
      } else {
        setEntitlement(null)
      }
      setHasFeatureAccess(data.hasAccess)
    } catch {
      setEntitlement(null)
      setHasFeatureAccess(false)
      setIsAdminBypassAccount(false)
      setError('Unable to verify subscription status.')
    } finally {
      setLoading(false)
    }
  }, [featureId])

  useEffect(() => {
    fetchEntitlement()
  }, [fetchEntitlement])

  useEffect(() => {
    const onForeground = () => {
      const now = Date.now()
      if (now - lastFocusRefetch.current < FOCUS_REFETCH_THROTTLE_MS) return
      lastFocusRefetch.current = now
      void fetchEntitlement()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      onForeground()
    }
    window.addEventListener('focus', onForeground)
    window.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', onForeground)
      window.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fetchEntitlement])

  useEffect(() => {
    const onPostPurchaseSync = () => {
      void fetchEntitlement()
    }
    window.addEventListener(POST_PURCHASE_SYNC_EVENT, onPostPurchaseSync as EventListener)
    return () =>
      window.removeEventListener(
        POST_PURCHASE_SYNC_EVENT,
        onPostPurchaseSync as EventListener
      )
  }, [fetchEntitlement])

  useEffect(
    () => addStateRefreshListener(['subscriptions', 'auth', 'all'], () => void fetchEntitlement()),
    [fetchEntitlement]
  )

  useEffect(() => {
    const status = entitlement?.status
    if (!status || (status !== 'past_due' && status !== 'expired')) return
    const path = typeof window !== 'undefined' ? window.location.pathname : 'unknown'
    const key = `${path}:${featureId ?? 'none'}:${status}`
    if (trackedLifecycleViews.current.has(key)) return
    trackedLifecycleViews.current.add(key)
    trackSubscriptionStateViewed({
      status,
      surface: 'use_entitlement',
      featureId: featureId ?? null,
    })
  }, [entitlement?.status, featureId])

  const isActiveOrGrace = entitlement?.status === 'active' || entitlement?.status === 'grace'
  const featureAccess =
    hasFeatureAccess ??
    (featureId && entitlement
      ? hasFeatureAccessForPlans(
          toPlanIds(entitlement.plans),
          entitlement.status,
          featureId
        )
      : false)
  const upgradePath =
    entitlement?.upgradePath ??
    (featureId ? buildFeatureUpgradePath(featureId) : '/pricing')

  const hasAccess = useCallback(
    (fid: SubscriptionFeatureId): boolean => {
      if (fid === featureId && hasFeatureAccess !== undefined) return hasFeatureAccess
      if (!entitlement) return false
      return hasFeatureAccessForPlans(
        toPlanIds(entitlement.plans),
        entitlement.status,
        fid
      )
    },
    [entitlement, featureId, hasFeatureAccess]
  )

  return {
    entitlement,
    loading,
    error,
    featureAccess,
    hasAccess,
    isActiveOrGrace,
    upgradePath,
    isAdminBypassAccount,
    refetch: fetchEntitlement,
  }
}
