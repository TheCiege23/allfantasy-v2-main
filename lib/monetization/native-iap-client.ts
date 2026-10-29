import { useAppleIapPrices, restoreApplePurchases, manageAppleSubscriptions } from "./apple-iap-client"
import { useGooglePlayPrices, restoreGooglePlayPurchases, manageGooglePlaySubscriptions } from "./google-play-client"
import { isTrustedWebActivity } from "@/lib/platform/isTrustedWebActivity"
export function useNativeIapPrices() {
  const apple = useAppleIapPrices(), play = useGooglePlayPrices()
  return { nativeApp: apple.appleApp || play.playApp, prices: play.playApp ? play.prices : apple.prices,
    needsUpdate: apple.needsUpdate, storeLabel: play.playApp ? "Google Play" : "Apple", playApp: play.playApp, error: play.error }
}
export const restoreNativePurchases = () => isTrustedWebActivity() ? restoreGooglePlayPurchases() : restoreApplePurchases()
export async function manageNativeSubscriptions() {
  if (isTrustedWebActivity()) manageGooglePlaySubscriptions()
  else await manageAppleSubscriptions()
}
