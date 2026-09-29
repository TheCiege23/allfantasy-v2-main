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
 */

export const IOS_APP_UA_MARKER = "AllFantasyiOS"

export function isIosAppUserAgent(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && userAgent.includes(IOS_APP_UA_MARKER)
}

/** In the browser: is this page running inside the iOS app? Always false on the server. */
export function isInIosAppClient(): boolean {
  return typeof navigator !== "undefined" && isIosAppUserAgent(navigator.userAgent)
}

/**
 * The same test as a JS expression, for the inline <script> loaders in the root
 * layout (they run before any bundle, so they cannot import this module).
 */
export const IOS_APP_UA_TEST_JS = `(typeof navigator!=="undefined"&&navigator.userAgent.indexOf(${JSON.stringify(
  IOS_APP_UA_MARKER,
)})!==-1)`

/**
 * Where a signed-out visitor to `/core` goes inside the iOS app, or null for the
 * usual `/login` bounce.
 *
 * The app LAUNCHES at bare `/core` (`server.url` in ios-app/capacitor.config.json),
 * so on the web's rule a first-time user's very first screen was a sign-in form
 * with nothing saying what the app is. Only that exact launch URL goes to the
 * landing page: a deep link (`/core/trades`, `/core?league=…`) is someone who
 * already knows where they are going, and still goes to sign-in carrying it.
 *
 * Changing this rather than `server.url` fixes builds already in TestFlight — the
 * binary keeps opening `/core`, and the server decides what that means.
 */
export function iosAppSignedOutDestination(
  userAgent: string | null | undefined,
  segment: string,
  carriedQuery: string,
): string | null {
  if (!isIosAppUserAgent(userAgent)) return null
  if (segment !== "" || carriedQuery !== "") return null
  return "/"
}

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

export function isIosAppPurchaseApi(pathname: string): boolean {
  return (
    IOS_APP_PURCHASE_API_PREFIXES.some((p) => matchesPrefix(pathname, p)) ||
    IOS_APP_PURCHASE_API_PATTERNS.some((r) => r.test(pathname))
  )
}

/**
 * Runs before first paint (inline in the root layout) so hidden purchase links
 * never flash. Kept here so the marker is spelled once.
 */
export const IOS_APP_HTML_FLAG_SCRIPT = `try{if(navigator.userAgent.indexOf(${JSON.stringify(
  IOS_APP_UA_MARKER,
)})!==-1)document.documentElement.setAttribute("data-ios-app","1")}catch(e){}`
