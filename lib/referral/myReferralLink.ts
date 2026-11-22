'use client'

import { useEffect, useState } from 'react'
import { isReferralLink } from './referralShareLink'

/**
 * The signed-in user's own referral link, for share buttons (./referralShareLink.ts). One request per
 * page load, shared by every caller; `null` when signed out or when it cannot be read — a share then
 * goes out exactly as it did before, never blocked on this.
 */
let pending: Promise<string | null> | null = null

export function getMyReferralLink(): Promise<string | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  pending ??= fetch('/api/referral/link', { credentials: 'same-origin', cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: unknown) => {
      const link = j && typeof j === 'object' ? (j as Record<string, unknown>).link : null
      return isReferralLink(link) ? link : null
    })
    .catch(() => null)
  return pending
}

/** Forget the memoised link — between tests. */
export function resetMyReferralLink(): void {
  pending = null
}

/** The link once known (null until then, and when there is none). */
export function useMyReferralLink(enabled = true): string | null {
  const [link, setLink] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void getMyReferralLink().then((l) => {
      if (live) setLink(l)
    })
    return () => {
      live = false
    }
  }, [enabled])
  return link
}
