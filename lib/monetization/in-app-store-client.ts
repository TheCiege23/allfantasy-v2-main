/**
 * One hook for "are we inside a store-distributed app, and which store?"
 *
 * Inside the iOS app every purchase goes through Apple; inside the Android app
 * (TWA) every purchase goes through Google Play. Purchase surfaces use this to
 * show store prices, store wording, and Restore / Manage, instead of Stripe.
 * The open web gets `store: null` and keeps Stripe.
 */

import { manageAppleSubscriptions, restoreApplePurchases, useAppleIapPrices } from "@/lib/monetization/apple-iap-client"
import {
  manageGooglePlaySubscriptions,
  restoreGooglePlayPurchases,
  useGooglePlayPrices,
} from "@/lib/monetization/google-play-client"

export type InAppStore = "apple" | "google_play"

export function useInAppStore() {
  const apple = useAppleIapPrices()
  const play = useGooglePlayPrices()
  const store: InAppStore | null = apple.appleApp ? "apple" : play.playApp ? "google_play" : null
  const source = store === "apple" ? apple : play
  return {
    store,
    inStoreApp: store !== null,
    /** "Apple" or "Google Play", for button and price wording. */
    storeLabel: store === "apple" ? "Apple" : "Google Play",
    prices: store ? source.prices : ({} as Record<string, string>),
    needsUpdate: store ? source.needsUpdate : false,
    updateMessage:
      store === "apple"
        ? "Update the AllFantasy iOS app to make purchases."
        : "Update the AllFantasy app from Google Play to make purchases.",
    restore: (): Promise<number> => (store === "apple" ? restoreApplePurchases() : restoreGooglePlayPurchases()),
    manage: (): Promise<void> => (store === "apple" ? manageAppleSubscriptions() : manageGooglePlaySubscriptions()),
  }
}
