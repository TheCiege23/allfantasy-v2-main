/**
 * The native iOS app (Capacitor shell in `ios-app/`) is the website in a
 * WKWebView. It identifies itself by appending this marker to the WebView's
 * User-Agent (`ios.appendUserAgent` in ios-app/capacitor.config.json).
 *
 * WHY IT MATTERS — App Store Review Guideline 3.1.1: digital subscriptions,
 * tokens and donations bought inside an iOS app must go through Apple's in-app
 * purchase. We sell those through Stripe, so inside the app every purchase
 * surface is closed: pages redirect to /ios-app/plans, checkout APIs refuse,
 * and links to them are hidden (`html[data-ios-app]` rules in globals.css).
 * Anything an account has already bought keeps working — only BUYING is off.
 *
 * Guideline 4.8 is the second reason: Sign in with Apple is not live, and an
 * app that offers Google/Facebook/X/Discord/Spotify sign-in must also offer
 * it. Inside the app those buttons are hidden, leaving email sign-in.
 *
 * Guideline 5.1.2 is the third: ad tracking (Meta Pixel + Conversions API,
 * GTM and the TikTok/Reddit/Google tags it carries, the Facebook SDK) needs
 * Apple's App Tracking Transparency prompt, which the app does not show. So
 * none of it runs in the app — the root layout's loaders, lib/meta-client and
 * lib/meta-capi all check this marker — and App Privacy can truthfully say
 * "not used to track". First-party analytics (PostHog, Sentry) is not tracking
 * in Apple's sense and is unchanged.
 *
 * ⚠ A User-Agent can be forged, and that is fine HERE because the gate only
 * ever takes things AWAY. Spoofing the marker gets you a website you cannot
 * pay on; removing it gets you the normal website. Never use this marker to
 * GRANT anything — no gate exemption, no entitlement, no trust.
 *
 * ── Apple in-app purchase (builds that carry IOS_APP_IAP_UA_MARKER) ──────────
 * From build 1.1 the app has a StoreKit bridge (ios-app/ios/App/App/
 * AppleIAPHandler.swift) and appends a second marker. For those builds the
 * plan and token pages reopen and buy through Apple (lib/monetization/
 * apple-iap-client) — 3.1.1 is satisfied by selling through IAP, not by
 * selling nothing. Everything else stays closed: Stripe checkout APIs, the
 * billing portal, donations, the marketplace and league dues.
 *
 * The IAP marker DOES open something, so the rule above needs its reason
 * restated: what it opens is the pricing pages, which every browser already
 * sees, and the purchase itself is verified server-side from Apple's signed
 * transaction (lib/monetization/applePurchases). Forging the marker gets a
 * pricing page with no StoreKit behind it — still nothing granted.
 * Builds without the marker (1.0) keep the full gate: they have no bridge, so
 * a reopened page would be a dead end.
 */

export const IOS_APP_UA_MARKER = "AllFantasyiOS"
/** Appended by builds that can buy through StoreKit (ios-app/capacitor.config.json). */
export const IOS_APP_IAP_UA_MARKER = "AFIAP"

export function isIosAppUserAgent(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && userAgent.includes(IOS_APP_UA_MARKER)
}

/** An iOS app build with the StoreKit bridge. Implies isIosAppUserAgent. */
export function isIosAppIapUserAgent(userAgent: string | null | undefined): boolean {
  return isIosAppUserAgent(userAgent) && (userAgent as string).includes(IOS_APP_IAP_UA_MARKER)
}

/** In the browser: is this page running inside the iOS app? Always false on the server. */
export function isInIosAppClient(): boolean {
  return typeof navigator !== "undefined" && isIosAppUserAgent(navigator.userAgent)
}

/** In the browser: inside an iOS app build that sells through Apple? */
export function isInIosAppWithIapClient(): boolean {
  return typeof navigator !== "undefined" && isIosAppIapUserAgent(navigator.userAgent)
}

/**
 * Inside an app that sells NOTHING (a build without the StoreKit bridge). This,
 * not isInIosAppClient, is the test for "hide the offer to buy a plan or tokens".
 */
export function isInIosAppWithoutIapClient(): boolean {
  return isInIosAppClient() && !isInIosAppWithIapClient()
}

/**
 * The same test as a JS expression, for the inline <script> loaders in the root
 * layout (they run before any bundle, so they cannot import this module).
 */
export const IOS_APP_UA_TEST_JS = `(typeof navigator!=="undefined"&&navigator.userAgent.indexOf(${JSON.stringify(
  IOS_APP_UA_MARKER,
)})!==-1)`

/** Where a purchase page sends the iOS app. Must not itself be a purchase page. */
export const IOS_APP_PLANS_PATH = "/ios-app/plans"

/**
 * Pages whose job is to take money. Prefix match on a path segment boundary.
 * `/support` is the donation page (despite the name); `/contact` is support.
 */
export const IOS_APP_PURCHASE_PAGE_PREFIXES: readonly string[] = [
  "/upgrade",
  "/pricing",
  "/commissioner-upgrade",
  "/tokens",
  "/donate",
  "/support",
]

/** Survivor exile token shop — a page per league, so it needs a pattern. */
const IOS_APP_PURCHASE_PAGE_PATTERNS: readonly RegExp[] = [/^\/survivor\/[^/]+\/exile\/tokens(?:\/|$)/]

/**
 * API routes that start a payment or hand the user to Stripe. Refused from the
 * app so a purchase cannot start even from a button the CSS failed to hide.
 */
export const IOS_APP_PURCHASE_API_PREFIXES: readonly string[] = [
  "/api/monetization/checkout",
  "/api/stripe/create-checkout-session",
  "/api/subscription/billing-portal",
  "/api/donate",
  "/api/bracket/donate",
  "/api/marketplace/purchase",
]

const IOS_APP_PURCHASE_API_PATTERNS: readonly RegExp[] = [/^\/api\/leagues\/[^/]+\/finance\/entry-checkout(?:\/|$)/]

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isIosAppPurchasePage(pathname: string): boolean {
  return (
    IOS_APP_PURCHASE_PAGE_PREFIXES.some((p) => matchesPrefix(pathname, p)) ||
    IOS_APP_PURCHASE_PAGE_PATTERNS.some((r) => r.test(pathname))
  )
}

/**
 * The purchase pages an IAP build may open: they sell only catalog plans and
 * token packs, every one of which is an App Store product, and they check out
 * through lib/monetization/checkout-client, which hands an app purchase to
 * StoreKit. A subset of IOS_APP_PURCHASE_PAGE_PREFIXES — donations (/donate,
 * /support) and the Survivor exile shop are not App Store products and stay
 * closed in every build.
 * Keep in step with the `html[data-ios-app]:not([data-ios-iap])` link rules in
 * app/globals.css.
 */
export const IOS_APP_IAP_PAGE_PREFIXES: readonly string[] = [
  "/upgrade",
  "/pricing",
  "/commissioner-upgrade",
  "/tokens",
]

export function isIosAppIapPage(pathname: string): boolean {
  return IOS_APP_IAP_PAGE_PREFIXES.some((p) => matchesPrefix(pathname, p))
}

/**
 * Is this page closed to a request with this User-Agent? Only meaningful for an
 * iOS app UA: the purchase pages, minus the IAP pages when the build can buy.
 */
export function isIosAppClosedPage(pathname: string, userAgent: string | null | undefined): boolean {
  if (!isIosAppPurchasePage(pathname)) return false
  return !(isIosAppIapUserAgent(userAgent) && isIosAppIapPage(pathname))
}

export function isIosAppPurchaseApi(pathname: string): boolean {
  return (
    IOS_APP_PURCHASE_API_PREFIXES.some((p) => matchesPrefix(pathname, p)) ||
    IOS_APP_PURCHASE_API_PATTERNS.some((r) => r.test(pathname))
  )
}

/**
 * Runs before first paint (inline in the root layout) so hidden purchase links
 * never flash. Kept here so the markers are spelled once. `data-ios-iap` is set
 * only alongside `data-ios-app`, mirroring isIosAppIapUserAgent.
 */
export const IOS_APP_HTML_FLAG_SCRIPT = `try{var u=navigator.userAgent;if(u.indexOf(${JSON.stringify(
  IOS_APP_UA_MARKER,
)})!==-1){document.documentElement.setAttribute("data-ios-app","1");if(u.indexOf(${JSON.stringify(
  IOS_APP_IAP_UA_MARKER,
)})!==-1)document.documentElement.setAttribute("data-ios-iap","1")}}catch(e){}`
