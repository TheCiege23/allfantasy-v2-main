/**
 * The AllFantasy iPhone app on the App Store (the Capacitor shell in `ios-app/`, live since 2026-11-19), and
 * when a page may offer it.
 *
 * iPhone browser → the App Store; Android → Google Play (lib/platform/androidApp.ts); iPad and desktop → the
 * website. Nobody already inside the app is asked to install it.
 *
 * The app is iPhone-only (`TARGETED_DEVICE_FAMILY = 1`, docs/app-store/RUNBOOK.md), so an iPad is not offered it.
 *
 * Unlike Android, there is no "open this invite in the app": the app claims only /verify/email as a universal
 * link (lib/platform/appSiteAssociation.ts), so an invite link always opens in Safari. The offer is therefore
 * "join here, then get the app" — the app is the same site, so the league is there after sign-in.
 *
 * Pure, so the rule is testable; pass navigator.userAgent in the browser.
 */
import { appleTouchDevice } from '@/lib/platform/appleTouchDevice'
import { isIosAppUserAgent } from '@/lib/platform/iosApp'

/** App Store Connect → App Information → Apple ID. Also the Smart App Banner's app-id (app/layout.tsx). */
export const APP_STORE_APP_ID = '6815778932'

/** Country-neutral: Apple sends each visitor to their own storefront. */
export const APP_STORE_URL = `https://apps.apple.com/app/allfantasy/id${APP_STORE_APP_ID}`

/** Offer the app: an iPhone browser that is not already our app. */
export function shouldOfferIosApp(userAgent: string | null | undefined): boolean {
  return appleTouchDevice(userAgent) === 'iPhone' && !isIosAppUserAgent(userAgent)
}
