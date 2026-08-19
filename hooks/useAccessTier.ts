'use client'

/**
 * The single source of truth for guest | free | paid access state. Every gate in the app
 * (FeatureGate, landing CTAs, dashboard locks) should read from this instead of ad-hoc
 * session/entitlement checks scattered around.
 */

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useEntitlements } from '@/hooks/useEntitlements'
import { resolveAccessTier, type AccessTier, type PaidTier } from '@/lib/access/accessTier'

type GuestStatusResponse = {
  isGuest: boolean
  sleeperUsername: string | null
  displayName: string | null
}

export interface UseAccessTierResult {
  tier: AccessTier
  paidTiers: PaidTier[]
  isAuthenticated: boolean
  isGuest: boolean
  /** Guest's imported Sleeper username, if any (from the af_guest_session cookie). Null until fetched or if no guest import exists. */
  guestSleeperUsername: string | null
  guestDisplayName: string | null
  loading: boolean
}

export function useAccessTier(): UseAccessTierResult {
  const { status } = useSession()
  const entitlements = useEntitlements()
  const [guestStatus, setGuestStatus] = useState<GuestStatusResponse | null>(null)
  const [guestLoading, setGuestLoading] = useState(true)

  useEffect(() => {
    if (status === 'authenticated') {
      setGuestLoading(false)
      return
    }
    let cancelled = false
    fetch('/api/guest-mode/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: GuestStatusResponse | null) => {
        if (!cancelled) setGuestStatus(data)
      })
      .catch(() => {
        if (!cancelled) setGuestStatus(null)
      })
      .finally(() => {
        if (!cancelled) setGuestLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [status])

  const isAuthenticated = status === 'authenticated'
  const resolved = resolveAccessTier({
    isAuthenticated,
    hasPro: entitlements.hasPro,
    hasCommissioner: entitlements.hasCommissioner,
    hasWarRoom: entitlements.hasWarRoom,
    hasSupreme: entitlements.hasSupreme,
  })

  const loading = status === 'loading' || (isAuthenticated ? entitlements.loading : guestLoading)

  return {
    ...resolved,
    guestSleeperUsername: guestStatus?.isGuest ? guestStatus.sleeperUsername : null,
    guestDisplayName: guestStatus?.isGuest ? guestStatus.displayName : null,
    loading,
  }
}
