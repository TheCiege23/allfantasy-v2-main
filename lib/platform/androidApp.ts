/**
 * The AllFantasy Android app (a Trusted Web Activity shipped through Google Play, docs/play-store/), and
 * when a page may offer it.
 *
 * Android → the app or Google Play; iPhone and desktop → the website. An iPhone never sees an Android
 * offer, and nobody already inside the app is asked to install it.
 *
 * Pure apart from `isTrustedWebActivity`, which the caller passes in, so the rule is testable.
 */

/** The Play package (docs/play-store/twa-manifest.json `packageId`, public/.well-known/assetlinks.json). */
const ANDROID_APP_PACKAGE = 'ai.allfantasy.app'

export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_APP_PACKAGE}`

/** An Android phone or tablet browser. iPhone/iPad/desktop user agents never contain "Android". */
function isAndroidUserAgent(userAgent: string | null | undefined): boolean {
  return /Android/i.test(String(userAgent ?? ''))
}

/** Offer the app: an Android browser that is not already our app. */
export function shouldOfferAndroidApp(input: { userAgent: string | null | undefined; inTrustedWebActivity: boolean }): boolean {
  return isAndroidUserAgent(input.userAgent) && !input.inTrustedWebActivity
}

/**
 * Open THIS page in the app: an Android intent for the same https URL, addressed to our package. The app
 * is verified for the site (assetlinks.json), so it opens on the same invite — the code and every query
 * parameter ride along. Not installed → Chrome follows `browser_fallback_url` to Google Play.
 *
 * `pathAndQuery` must be a same-site path (it starts with one "/"); anything else gets the Play URL, so a
 * crafted value can never point the intent at another host.
 */
export function androidAppIntentUrl(host: string, pathAndQuery: string): string {
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host) || !pathAndQuery.startsWith('/') || pathAndQuery.startsWith('//')) return PLAY_STORE_URL
  return `intent://${host}${pathAndQuery}#Intent;scheme=https;package=${ANDROID_APP_PACKAGE};S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`
}
