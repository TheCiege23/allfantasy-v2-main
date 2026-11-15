'use client'

import { useEffect, useState } from 'react'

/**
 * The plan cards' view of the AF Pro free trial (lib/monetization/freeTrial.ts), from
 * /api/monetization/trial-eligibility. A LABEL, never the decision: the checkout route re-checks on the
 * server and that is what Stripe sees.
 *
 *   eligible true  → the card offers "Start a 7-day free trial"
 *   eligible null  → signed out: the card says new members get the trial
 *   eligible false → nothing is said
 *
 * A native store build never asks (the caller passes `enabled: false`), and the endpoint answers
 * `days: 0` to the iOS shell anyway — the app never shows a web offer.
 */
export type TrialOffer = { days: number; skus: readonly string[]; eligible: boolean | null }

const NONE: TrialOffer = { days: 0, skus: [], eligible: false }

export function useTrialOffer(enabled = true): TrialOffer {
  const [offer, setOffer] = useState<TrialOffer>(NONE)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    fetch('/api/monetization/trial-eligibility', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: unknown) => {
        if (cancelled || !j || typeof j !== 'object') return
        const v = j as Record<string, unknown>
        const days = typeof v.days === 'number' && Number.isInteger(v.days) && v.days > 0 ? v.days : 0
        const skus = Array.isArray(v.skus) ? v.skus.filter((s): s is string => typeof s === 'string') : []
        const eligible = v.eligible === true ? true : v.eligible === null ? null : false
        setOffer(days > 0 ? { days, skus, eligible } : NONE)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [enabled])
  return offer
}

/** Does this offer apply to this SKU on this card? */
export function trialAppliesTo(offer: TrialOffer, sku: string | null | undefined): boolean {
  return Boolean(sku && offer.days > 0 && offer.eligible !== false && offer.skus.includes(sku))
}
