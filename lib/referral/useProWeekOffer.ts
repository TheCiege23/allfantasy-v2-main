'use client'

import { useEffect, useState } from 'react'

/**
 * "Give a week, get a week" as a promoting surface should show it (lib/referral/proWeek.ts), from
 * /api/referral/pro-week-offer. `days: 0` means say nothing — the offer is off, or this is the iOS app,
 * which never advertises it (App Store 3.1.1 / 3.1.3).
 */
export type ProWeekOffer = { days: number; cap: number; earnedInWindow: number | null }

const NONE: ProWeekOffer = { days: 0, cap: 0, earnedInWindow: null }

export function parseProWeekOffer(j: unknown): ProWeekOffer {
  if (!j || typeof j !== 'object') return NONE
  const v = j as Record<string, unknown>
  const days = typeof v.days === 'number' && Number.isInteger(v.days) && v.days > 0 ? v.days : 0
  if (!days) return NONE
  const cap = typeof v.cap === 'number' && Number.isInteger(v.cap) && v.cap > 0 ? v.cap : 0
  const earned = typeof v.earnedInWindow === 'number' && Number.isInteger(v.earnedInWindow) && v.earnedInWindow >= 0 ? v.earnedInWindow : null
  return { days, cap, earnedInWindow: earned }
}

export function useProWeekOffer(enabled = true): ProWeekOffer {
  const [offer, setOffer] = useState<ProWeekOffer>(NONE)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetch('/api/referral/pro-week-offer', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        if (!cancelled) setOffer(parseProWeekOffer(j))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled])
  return offer
}
