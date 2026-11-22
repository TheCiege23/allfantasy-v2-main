'use client'

import { PricingV4, type PricingPack, type PricingPlan } from '@/components/core-app/screens/PricingV4'
import type { PricingAccount } from '@/lib/core-app/pricingAccount'
import type { ComparisonGroup } from '@/lib/monetization/planComparison'

/*
 * Every /api/ call from the screen (geo restriction, post-purchase sync, checkout) is refused here, so
 * nothing reaches a database or Stripe. The screen renders its own fallback for each, which is what a
 * review should see.
 */
type HarnessWindow = Window & { __afPricingHarness?: boolean }
if (typeof window !== 'undefined' && !(window as HarnessWindow).__afPricingHarness) {
  ;(window as HarnessWindow).__afPricingHarness = true
  const real = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, window.location.origin)
    if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
      return Promise.resolve(new Response('{"error":"harness: no API"}', { status: 503, headers: { 'Content-Type': 'application/json' } }))
    }
    return real(input, init)
  }
}

export default function PricingHarnessClient(props: {
  plans: PricingPlan[]
  packs: PricingPack[]
  signedIn: boolean
  account: PricingAccount | null
  comparison: ComparisonGroup[]
}) {
  return <PricingV4 {...props} />
}
