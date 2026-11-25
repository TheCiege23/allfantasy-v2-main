'use client'

import { useEffect, useState } from 'react'
import { isInIosAppClient } from '@/lib/platform/iosApp'
import { isTrustedWebActivity } from '@/lib/platform/isTrustedWebActivity'
import { lockTrialCopy, lockTrialSku, type LockTrialCopy } from '@/lib/monetization/lockTrialOffer'
import { NO_TRIAL_OFFER, parseTrialOffer, type TrialOffer } from '@/lib/monetization/useTrialOffer'

/**
 * A lock card's view of the AF Pro free trial (`lockTrialOffer.ts` has the why). Returns the words to
 * show, or null — and null is the answer everywhere the trial must not be mentioned:
 *
 *   - ANY iOS app build, with or without StoreKit (App Store 3.1.1 / 3.1.3: the app sells through Apple
 *     or not at all and never points at a web offer). The endpoint answers `days: 0` to the iOS shell
 *     too; this does not even ask.
 *   - the Android Trusted Web Activity (Google Play billing policy — no Stripe offer inside it);
 *   - a viewer the server does not call eligible (already subscribed, ever; signed out; trial off);
 *   - a lock for a plan the trial does not cover.
 *
 * ONE request per page, however many locks it draws: a page can carry several (a matchup's locks, the
 * draft board's AF ADP header, every Chimmy answer), and each asking separately would be N identical
 * calls. The answer is reused for a few minutes, then asked again.
 */

const TTL_MS = 5 * 60 * 1000
let cached: { at: number; offer: Promise<TrialOffer> } | null = null

function loadOffer(now: number): Promise<TrialOffer> {
  if (cached && now - cached.at < TTL_MS) return cached.offer
  const offer = fetch('/api/monetization/trial-eligibility', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then(parseTrialOffer)
    .catch(() => NO_TRIAL_OFFER)
  cached = { at: now, offer }
  return offer
}

/** For tests: forget the shared answer. */
export function resetLockTrialOfferCache(): void {
  cached = null
}

/** Is this a surface where a web trial may be offered at all? Client only. */
export function lockTrialAllowedHere(): boolean {
  if (typeof window === 'undefined') return false
  if (isInIosAppClient()) return false
  if (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-ios-app')) return false
  return !isTrustedWebActivity()
}

export function useLockTrialOffer(
  requiredPlan: string | null | undefined,
  language?: string | null,
  enabled = true,
): LockTrialCopy | null {
  const [offer, setOffer] = useState<TrialOffer>(NO_TRIAL_OFFER)
  // A lock for AF Commissioner or AF Legacy never asks: the trial is not theirs to offer.
  const applies = enabled && lockTrialSku(requiredPlan) !== null
  useEffect(() => {
    if (!applies || !lockTrialAllowedHere()) return
    let cancelled = false
    void loadOffer(Date.now()).then((o) => {
      if (!cancelled) setOffer(o)
    })
    return () => {
      cancelled = true
    }
  }, [applies])
  if (!applies) return null
  return lockTrialCopy(offer, requiredPlan, language)
}
