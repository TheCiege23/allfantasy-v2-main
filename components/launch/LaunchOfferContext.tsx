'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { LaunchOfferView } from '@/lib/monetization/foundingMember'

/*
 * Hands the per-viewer launch view (countdown instant + founding-member offer) from a server
 * LAYOUT to the client pricing screens under it.
 *
 * ⚠ WHY A LAYOUT AND A CONTEXT, NOT A PAGE PROP: working out the offer needs the session and the
 * account's creation date, which is async — and `app/pricing/page.tsx` and `app/upgrade/page.tsx`
 * are deliberately synchronous (their redirect and `focusPlanFamily` contracts are called directly
 * by tests). The layout does the async read once; the screens read it here. Anything rendered
 * without the provider (the /pro and /all-access surfaces, tests) gets `null` and shows no strip.
 */
const LaunchOfferContext = createContext<LaunchOfferView | null>(null)

export function LaunchOfferProvider({ offer, children }: { offer: LaunchOfferView | null; children: ReactNode }) {
  return <LaunchOfferContext.Provider value={offer}>{children}</LaunchOfferContext.Provider>
}

export function useLaunchOffer(): LaunchOfferView | null {
  return useContext(LaunchOfferContext)
}
