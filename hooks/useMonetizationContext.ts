'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FOCUS_REFETCH_THROTTLE_MS } from '@/lib/state-consistency/refresh-triggers'
import { POST_PURCHASE_SYNC_EVENT } from '@/lib/state-consistency/post-purchase-sync-events'
import { addStateRefreshListener } from '@/lib/state-consistency/state-events'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'
import type { TokenSpendPreview } from '@/lib/tokens/TokenSpendService'

type EntitlementSnapshot = {
  plans: string[]
  status: 'active' | 'grace' | 'past_due' | 'expired' | 'none'
  currentPeriodEnd: string | null
  gracePeriodEnd: string | null
}

type FeatureContext = {
  featureId: SubscriptionFeatureId
  hasAccess: boolean
  requiredPlan: string | null
  upgradePath: string
  message: string
}

type TokenPreviewContext = {
  ruleCode: string
  preview: TokenSpendPreview | null
  error: string | null
}

type MonetizationContextResponse = {
  entitlement: EntitlementSnapshot
  bundleInheritance?: {
    hasSupreme: boolean
    inheritedPlanIds: string[]
    effectivePlanIds: string[]
  }
  entitlementMessage: string
  feature: FeatureContext | null
  tokenBalance: {
    balance: number
    lifetimePurchased: number
    lifetimeSpent: number
    lifetimeRefunded: number
    updatedAt: string
  }
  tokenPreviews: TokenPreviewContext[]
}

export function useMonetizationContext(options?: {
  featureId?: SubscriptionFeatureId
  ruleCodes?: string[]
  enabled?: boolean
}) {
  const featureId = options?.featureId
  const enabled = options?.enabled !== false
  const ruleCodesKey = (options?.ruleCodes ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .join('|')
  const ruleCodes = useMemo(
    () => Array.from(new Set(ruleCodesKey.split('|').map((value) => value.trim()).filter(Boolean))),
    [ruleCodesKey]
  )

  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<MonetizationContextResponse | null>(null)
  const lastFocusRefetch = useRef(0)

  const fetchContext = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (featureId) params.set('feature', featureId)
      for (const ruleCode of ruleCodes) params.append('ruleCode', ruleCode)
      const query = params.toString()
      const res = await fetch(`/api/monetization/context${query ? `?${query}` : ''}`, { cache: 'no-store' })
      const json = (await res.json().catch(() => ({}))) as MonetizationContextResponse & { error?: string }
      if (!res.ok) {
        setError(json?.error ?? 'Unable to load monetization context.')
        setData(null)
        return
      }
      setData(json)
    } catch {
      setError('Unable to load monetization context.')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [enabled, featureId, ruleCodes])

  useEffect(() => {
    void fetchContext()
  }, [fetchContext])

  useEffect(() => {
    if (!enabled) return
    const onForeground = () => {
      const now = Date.now()
      if (now - lastFocusRefetch.current < FOCUS_REFETCH_THROTTLE_MS) return
      lastFocusRefetch.current = now
      void fetchContext()
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
  }, [enabled, fetchContext])

  useEffect(() => {
    if (!enabled) return
    const onPostPurchaseSync = () => {
      void fetchContext()
    }
    window.addEventListener(POST_PURCHASE_SYNC_EVENT, onPostPurchaseSync as EventListener)
    return () =>
      window.removeEventListener(
        POST_PURCHASE_SYNC_EVENT,
        onPostPurchaseSync as EventListener
      )
  }, [enabled, fetchContext])

  useEffect(() => {
    if (!enabled) return
    return addStateRefreshListener(['subscriptions', 'tokens', 'all'], () => void fetchContext())
  }, [enabled, fetchContext])

  const previewsByRuleCode = useMemo(() => {
    const map = new Map<string, TokenPreviewContext>()
    for (const item of data?.tokenPreviews ?? []) {
      map.set(item.ruleCode, item)
    }
    return map
  }, [data?.tokenPreviews])

  return {
    loading,
    error,
    data,
    entitlement: data?.entitlement ?? null,
    bundleInheritance: data?.bundleInheritance ?? null,
    feature: data?.feature ?? null,
    tokenBalance: data?.tokenBalance ?? null,
    previewsByRuleCode,
    refetch: fetchContext,
  }
}

