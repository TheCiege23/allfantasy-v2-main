import { NextResponse } from "next/server"
import { isSpeculativeRequestHeaders } from "@/lib/http/speculativeRequest"
import { hasMachineCredential } from "@/lib/http/machineCredential"
import { LEAGUE_FIRST_COOKIE, LEAGUE_FIRST_PARAM, parseLeagueFirstToggle } from "@/lib/core-app/leagueFirst"
import { SELECTABLE_LANGUAGES } from "@/lib/i18n/constants"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"

import { resolveAuthSecret } from "@/lib/auth/resolve-auth-secret"
import { requiresSessionAuth } from "@/lib/auth/session-auth-paths"
import { isFullyBlocked, isPaidBlocked } from "@/lib/geo/restrictedStates"
import { CARD_PAID_LOCK_MESSAGE, CARD_PAID_LOCK_REDIRECT } from "@/lib/geo/cardLockCopy"
import { resolveEdgeGeo } from "@/lib/geo/geoHeaders"
import { resolveGeoByIp } from "@/lib/geo/geoIpCache"
import { vpnStatusFromHeaders, type VpnStatus } from "@/lib/geo/vpnStatus"
import { getRelayRangeSetEdge } from "@/lib/geo/privateRelayEdge"
import { getServedOrigin } from "@/lib/http/served-origin"
import { clientIpFromHeaders } from "@/lib/http/clientIp"
import { INTERNAL_HOP_HEADER, verifyInternalHop } from "@/lib/http/internalHop"
import { checkOriginLock, originLockRefusal, reportOriginLock } from "@/lib/http/originLock"
import { getPublicSiteHostname } from "@/lib/site-public-origin"
import { GUEST_SESSION_COOKIE_NAME } from "@/lib/guest-mode/guestSessionToken"
import { applyAttributionCapture } from "@/lib/analytics/attributionCookies"
import {
  IOS_APP_PLANS_PATH,
  isIosAppPurchaseApi,
  isIosAppPurchasePage,
  isIosAppUserAgent,
} from "@/lib/platform/iosApp"
import { isSessionRevoked } from "@/lib/auth/sessionRevocation"

/**
 * Inside the iOS app nothing is for sale (App Store guideline 3.1.1 — see
 * lib/platform/iosApp). Checked ahead of every geo gate: it is a UA read with
 * no network call, and it only ever refuses, so running first cannot let
 * anything through that a later gate would have stopped.
 */
function iosAppPurchaseRefusal(request: NextRequest, pathname: string): NextResponse | null {
  if (!isIosAppUserAgent(request.headers.get("user-agent"))) return null
  if (isApiPath(pathname)) {
    if (!isIosAppPurchaseApi(pathname)) return null
    return NextResponse.json(
      { error: "not_available_in_ios_app", message: "Purchases aren't available in the iOS app." },
      { status: 403, headers: { "cache-control": "no-store" } },
    )
  }
  if (!isIosAppPurchasePage(pathname)) return null
  return NextResponse.redirect(new URL(IOS_APP_PLANS_PATH, request.url), 307)
}

/**
 * The iOS app opens at /core (ios-app/capacitor.config.json). Signed out, /core
 * sends people to /login — right for a web deep link, wrong for someone opening
 * the app: the owner's call (2026-09-29) is that they land on the landing page,
 * which has its own Sign in and Create account. Bare /core only, so a deep link
 * like /core/trades still goes through /login?callbackUrl= and comes back.
 *
 * ⚠ "Signed in" is the DASHBOARD's predicate — a non-empty token.id — not
 * token.sub. next-auth always sets sub; only the jwt callback sets id, and a
 * looser test here is exactly how "/" once bounced visitors to /login forever.
 */
async function iosAppSignedOutLanding(request: NextRequest, pathname: string): Promise<NextResponse | null> {
  if (pathname !== "/core") return null
  // ⚠ A query IS a deep link: `?league=` alone decides which league /core opens, and the
  // pathname cannot see it. Measured live 2026-09-29: `/core?league=<id>` in the app was sent
  // here to "/" with the league stripped, while Safari kept it in /login?callbackUrl=.
  if (request.nextUrl.search) return null
  if (!isIosAppUserAgent(request.headers.get("user-agent"))) return null
  const secret = resolveAuthSecret()
  if (!secret) return null
  const token = await getToken({ req: request, secret })
  const id = typeof token?.id === "string" ? token.id.trim() : ""
  // A session that was signed out (but whose cookie the device kept) counts as signed out.
  if (id && !(await isSessionRevoked(token))) return null
  const landing = new URL("/", request.url)
  landing.search = ""
  return NextResponse.redirect(landing, 307)
}

/**
 * Once a visitor is authenticated, the no-login trial cookie (`af_guest_session`)
 * has served its purpose: its `LegacyUser` is claimed on sign-in (AF_GATE0 §3.5),
 * and the dashboard reads it only when there is NO authenticated user. Clear it on
 * authenticated navigations so the trial token is invalidated (and a later logout
 * doesn't resurrect the guest board). No-op when the cookie isn't present.
 */
function clearGuestTrialCookie(request: NextRequest, response: NextResponse): NextResponse {
  if (request.cookies.get(GUEST_SESSION_COOKIE_NAME)) {
    response.cookies.delete(GUEST_SESSION_COOKIE_NAME)
  }
  return response
}

/**
 * Redirect apex ↔ www for allfantasy.ai so document origin matches manifest `id` and SEO canonical.
 * Uses the same host as NEXT_PUBLIC_SITE_URL / NEXTAUTH_URL when set.
 */
function canonicalProductionHostRedirect(request: NextRequest): NextResponse | null {
  /*
   * ⚠ `/.well-known/` MUST NEVER REDIRECT, ON ANY HOST. These files are how a
   * host proves something about itself, so the answer is host-specific by
   * definition and a 308 to the canonical host is not an equivalent answer —
   * it is a refusal to answer.
   *
   * Measured against Google's own checker, which rejects the redirect outright
   * rather than following it:
   *
   *   https://www.allfantasy.ai/.well-known/assetlinks.json  ->  308
   *   "Redirect encountered while fetching statements ...
   *    redirects are disallowed for security reasons (NOT_FOLLOWED_MAX_FORWARDS)"
   *
   * docs/play-store/twa-manifest.json lists `www.allfantasy.ai` in
   * additionalTrustedOrigins, so Android verifies that origin too and the whole
   * Trusted Web Activity fails to verify — which shows up as the installed app
   * opening with a browser address bar rather than full screen.
   *
   * This is not specific to Digital Asset Links: apple-app-site-association,
   * ACME http-01 challenges and security.txt all break the same way. The rule
   * is the path, not the file.
   */
  if (request.nextUrl.pathname.startsWith("/.well-known/")) return null

  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase()
  if (!host) return null
  if (host === "localhost" || host.endsWith(".vercel.app")) return null

  const canonicalHost = getPublicSiteHostname()
  if (host === canonicalHost) return null

  const isAf = host === "allfantasy.ai" || host === "www.allfantasy.ai"
  const canonAf = canonicalHost === "allfantasy.ai" || canonicalHost === "www.allfantasy.ai"
  if (!isAf || !canonAf) return null

  const url = request.nextUrl.clone()
  url.hostname = canonicalHost
  /*
   * ⚠ CLEARING THE PORT IS THE WHOLE FIX, AND OMITTING IT TOOK THE SITE DOWN.
   * `request.nextUrl` carries the port the SERVER is listening on. On Vercel that
   * was 443, so setting only `hostname` produced a correct public URL and this
   * line was never needed. On Railway the container listens on 8080, so the same
   * clone emitted `Location: https://www.allfantasy.ai:8080/` — a port that is
   * not published. Every visitor who typed the bare domain got a connection
   * failure while `www` served fine, which reads as "the whole site is down"
   * from outside and as "200 OK" from any check that skips the redirect.
   *
   * The canonical hosts here are always public HTTPS, so there is no port to
   * preserve; an empty port is the only correct value.
   */
  url.port = ''
  return NextResponse.redirect(url, 308)
}

/**
 * App routes that must have a valid NextAuth session (JWT).
 * Matches: /af-rankings, /dashboard/rankings (redirect), /league/*, /app/league/*
 * (the last with a deliberate exception for shareable news articles).
 *
 * The rule lives in lib/auth/session-auth-paths so it can be tested directly.
 */

/**
 * Paths that skip geo logic. Includes `/api/auth` so NextAuth + OAuth callbacks are never geo-blocked.
 *
 * 🛑 MACHINE CALLERS BELONG HERE, AND LEAVING THEM OUT IS A LATENT OUTAGE THAT
 * ONLY FIRES ONCE GEO STARTS WORKING. A geo restriction exists to stop a PERSON
 * in a prohibited state from using the product. A cron runner and a payment
 * webhook have no person behind them, so blocking one enforces nothing and
 * silently stops ingestion or billing instead.
 *
 * Measured 2026-09-07, and it was very nearly shipped: `WA` is the one
 * full_block state, this repo fires its crons over HTTP from GitHub Actions
 * (`.github/workflows/cron-slow-tier.yml`, `wc-cron.yml` → `${APP_URL}/api/cron/…`),
 * and GitHub Actions runs on Azure — whose West US 2 region is in Quincy,
 * WASHINGTON. A runner allocated a WA address hits the gate with no session, so
 * `isMiddlewareAdmin` is false, and the job takes a 403 GEO_BLOCKED and fails
 * silently. 38 cron routes and 4 webhooks were exposed this way.
 *
 * ⚠ IT WAS INVISIBLE UNTIL NOW ONLY BECAUSE THE GATE WAS BROKEN. With no edge
 * header, `country` was null and every request skipped the block — so this bug
 * and the bug that hid it are the same bug. Fixing geo detection is exactly what
 * arms it, whether the fix is the IP fallback in this PR or proxying the
 * hostname through Cloudflare. Both trip it.
 *
 * Exempting these opens nothing: geo and auth are independent, and each of these
 * carries its own (cron secret, Stripe/Resend signature). No path that serves a
 * human belongs in this list.
 */
const GEO_EXEMPT_PREFIXES = [
  "/geo-blocked",
  "/paid-restricted",
  "/restricted",
  "/vpn-blocked",
  "/offline",
  "/terms",
  "/privacy",
  "/data-deletion",
  "/disclaimer",
  "/mission",
  "/no-gambling-policy",
  "/ai-transparency",
  "/contact",
  "/api/health",
  "/api/auth",
  "/api/geo",
  "/api/af-debug",
  // Machine callers — see the block comment above. Not user traffic; each is
  // authenticated by its own secret or provider signature.
  "/api/cron",
  "/api/webhooks",
  "/api/stripe/webhook",
  "/api/community/discord/webhook",
  "/_next",
  "/favicon.ico",
  // Host-proof files (assetlinks.json, apple-app-site-association) fetched by Google and Apple
  // from their own servers, wherever those sit. A geo refusal there is a silent failure to
  // verify the Android or iOS app, and the files hold no user content.
  "/.well-known",
]

/** Exact-prefix match: `/pro` matches `/pro` and `/pro/foo`, not `/professional`. */
function isPaidPrefix(prefix: string, pathname: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

// ─── Username gate ────────────────────────────────────────────────────────────
// Authenticated users who have not yet chosen a username (OAuth sign-up skips
// the credentials signup flow) are redirected here before accessing the app.
const USERNAME_GATE_EXEMPT: string[] = [
  "/choose-username",
  "/login",
  "/signup",
  "/onboarding",
  "/verify",
  "/reset-password",
  "/admin",
  "/admin-login",
  "/auth",           // /auth/error and similar
  "/api/auth",       // NextAuth session/signout/CSRF endpoints must always be reachable
  "/api/user/profile", // username write endpoint — must stay reachable
  "/api/user/me",    // read current user — used by choose-username page
  "/api/af-debug",   // diagnostic endpoints (JSON only) — never redirect or 403 these
  "/api/health",
  "/api/geo",
  "/terms",
  "/privacy",
  "/data-deletion",
  "/disclaimer",
  "/mission",
  "/no-gambling-policy",
  "/ai-transparency",
  "/contact",
  "/support",
]

function isUsernameGateExempt(pathname: string): boolean {
  if (pathname === "/") return true
  for (const ex of USERNAME_GATE_EXEMPT) {
    if (pathname === ex || pathname.startsWith(`${ex}/`)) return true
  }
  return false
}
// ─────────────────────────────────────────────────────────────────────────────

/** Paid API surfaces in paid_block states (cron/webhooks like sync-profiles stay open). */
const PAID_GEO_PREFIXES = [
  "/api/subscription/checkout",
  "/api/subscription/portal",
  "/api/subscription/billing-portal",
  "/api/subscription/cancel",
  "/api/subscription/upgrade",
  "/api/monetization/checkout",
  "/api/user/autocoach",
  // (/api/bracket/stripe/checkout was listed here until 2026-09-25, when the in-app
  // bracket fees it sold were retired and the route deleted.)
]

/** Paid / premium surfaces — align with product geo policy (dispersal, import, rankings, league draft room). */
const PAID_GEO_PATTERNS = [
  /^\/api\/leagues\/[^/]+\/dispersal-draft/,
  /^\/league\/[^/]+\/dispersal-draft/,
  /^\/api\/leagues\/import/,
  /^\/dashboard\/rankings/,
  /^\/api\/leagues\/[^/]+\/integrity(?:\/|$)/,
  /^\/api\/leagues\/[^/]+\/autocoach-settings/,
]

function isExemptPath(pathname: string): boolean {
  for (const p of GEO_EXEMPT_PREFIXES) {
    if (pathname === p || pathname.startsWith(`${p}/`)) return true
  }
  return false
}

/** One definition of "paid surface" for the page gate and the API gate alike. */
function isPaidRoute(pathname: string): boolean {
  return PAID_GEO_PREFIXES.some((p) => isPaidPrefix(p, pathname)) || PAID_GEO_PATTERNS.some((r) => r.test(pathname))
}

/**
 * Which country and state this request is from. Edge-agnostic (Cloudflare in
 * production, Vercel on previews) and shared with lib/geo/detectUserState, so
 * the gate and the API report the same answer — they were two copies until
 * 2026-09-02, and both went blind together when production left Vercel.
 *
 * ⚠ THE IP FALLBACK RUNS ONLY WHEN NO EDGE PLACED THE REQUEST, and it is cached
 * for exactly that reason: this matcher covers all but static assets, so an
 * uncached lookup would be one vendor call per chunk and per API hit.
 * resolveGeoByIp collapses that to one call per IP per TTL. It fails open (null
 * on timeout, outage or an unplaceable IP): best-effort, not a substitute for
 * proxying through Cloudflare.
 */
async function resolveRequestGeo(request: NextRequest, vpn?: VpnStatus | null) {
  const edgeGeo = resolveEdgeGeo(request.headers)
  const ip = clientIpFromHeaders(request.headers)
  // A Private Relay address Apple's feed places (and the owner's rule accepts)
  // is judged by Apple's state, not the edge's reading of the relay address.
  const relay = placedRelayState(vpn)
  if (relay) return { ip, country: "US" as string | null, region: relay as string | null }
  const viaIp = edgeGeo.source === "unknown" && ip ? await resolveGeoByIp(ip) : null
  return {
    ip,
    country: viaIp ? viaIp.country : edgeGeo.country,
    region: viaIp ? viaIp.regionCode : edgeGeo.regionCode,
  }
}

/**
 * API surfaces exempt from the Washington block by prefix, because they are
 * machine-only and their handlers enforce their own keys — which the middleware
 * cannot check cheaply (/api/v1 keys live in the database).
 *
 *   /api/internal  x-internal-key / x-ingestion-key, server-to-server only
 *   /api/v1        the partner Intelligence API, API-key gated. ⚠ A product call:
 *                  a partner's SERVER may sit in Washington (Azure West US 2)
 *                  while its users do not. Remove this line to block it too.
 *
 * NOT in GEO_EXEMPT_PREFIXES on purpose: that list also exempts from the PAID
 * gate and applies to pages; these only relax the full block on the API.
 */
const FULL_BLOCK_API_EXEMPT_PREFIXES = ["/api/internal", "/api/v1"]

function isFullBlockApiExempt(pathname: string): boolean {
  return FULL_BLOCK_API_EXEMPT_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

// ─── The VPN gate ────────────────────────────────────────────────────────────
/*
 * 🛑 EVERY STATE GATE ABOVE READS THE LOCATION OF THE IP A VPN REPLACES. Until
 * 2026-09-24 the only VPN check was paid checkout, so a Washington user on any
 * VPN exit had the whole product — an exit in Canada reads as "not US" and
 * skips every state rule at once — and a paid-block user could use paid tools
 * they already held. Tor was worse: Cloudflare's `T1` normalises to "no
 * country", and no country passes everything.
 *
 * Owner's rule, 2026-09-24: over a VPN, proxy, Tor, data-centre address or
 * iCloud Private Relay, only PUBLIC pages load — the homepage, the legal pages
 * and /vpn-blocked. Sign-in, sign-up, the app and every API are refused,
 * WHATEVER COUNTRY the exit is in. Real visitors outside the US, not on a VPN,
 * are untouched: the state rules are about US states.
 *
 * The verdict comes from lib/geo/anonymizerCache — one vendor lookup per IP per
 * TTL, and it FAILS OPEN on an outage, like every geo check here.
 */

/**
 * API paths a VPN may still reach. Built FROM the geo list's machine entries so
 * a webhook added there is exempt here too — Stripe and GitHub call from data
 * centres, and a VPN check would refuse them. `/api/auth` is deliberately NOT
 * carried over whole: sign-in is refused over a VPN, so only NextAuth's
 * read-only and sign-out endpoints stay open (every page polls the session).
 *
 *   /api/subscription/billing-portal  cancelling must never depend on turning a
 *       VPN off (the earlier checkout decision, kept). /vpn-blocked links to it.
 */
const VPN_EXEMPT_API_PREFIXES = [
  ...GEO_EXEMPT_PREFIXES.filter((p) => p.startsWith("/api/") && p !== "/api/auth"),
  ...FULL_BLOCK_API_EXEMPT_PREFIXES,
  "/api/subscription/billing-portal",
  "/api/auth/session",
  "/api/auth/csrf",
  "/api/auth/providers",
  "/api/auth/signout",
  "/api/auth/_log",
  "/api/auth/error",
]

function isVpnExemptApi(pathname: string): boolean {
  return VPN_EXEMPT_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/**
 * Files a VPN visitor to a public page still needs: robots, sitemaps, the
 * manifest, the service worker, fonts. The matcher already skips images.
 * ⚠ An explicit extension list, not "has a dot": player slugs such as
 * `a.j.-brown` contain dots, and "has a dot" would wave those pages through.
 */
const STATIC_FILE = /\.(?:txt|xml|json|webmanifest|ico|js|css|map|woff2?|ttf|otf|mp4|webm|mp3|pdf|avif)$/i

/** Pages that load over a VPN. Everything else redirects to /vpn-blocked. */
function isVpnPublicPage(pathname: string): boolean {
  if (pathname === "/" || pathname === "") return true
  if (isExemptPath(pathname)) return true // legal pages and the block pages themselves
  // Android app-link verification is fetched by Google from a data centre.
  if (pathname === "/.well-known" || pathname.startsWith("/.well-known/")) return true
  return STATIC_FILE.test(pathname)
}

/**
 * Search, ad-review and link-preview crawlers run from data centres, so a VPN
 * check can flag them; refusing Googlebot de-indexes the site and refusing
 * AdsBot disapproves the ads. They are waved through on PAGES only, and only
 * when they carry no session or guest cookie.
 *
 * ⚠ A User-Agent can be forged, and this is bounded on purpose rather than
 * trusted: a forger gets exactly what an anonymous visitor sees — page HTML.
 * Sign-in is an API, and APIs have no crawler exemption, so the forger can
 * never hold a session; and anyone presenting a session cookie is checked
 * regardless of what their User-Agent says.
 */
const CRAWLER_UA =
  /\b(?:Googlebot|AdsBot-Google|Mediapartners-Google|Google-InspectionTool|GoogleOther|Storebot-Google|APIs-Google|FeedFetcher-Google|bingbot|BingPreview|Applebot|DuckDuckBot|YandexBot|facebookexternalhit|Facebot|meta-externalagent|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|TelegramBot|Pinterestbot|redditbot)\b/i

function hasSessionOrGuestCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((c) => c.name.includes("next-auth.session-token") || c.name.includes("authjs.session-token") || c.name === GUEST_SESSION_COOKIE_NAME)
}

function isAnonymousCrawler(request: NextRequest): boolean {
  const method = request.method.toUpperCase()
  if (method !== "GET" && method !== "HEAD") return false
  if (!CRAWLER_UA.test(request.headers.get("user-agent") ?? "")) return false
  return !hasSessionOrGuestCookie(request)
}

/**
 * Tor from the edge header (free); everything else from the cached vendor
 * verdict — and, for an anonymized address, Apple's Private Relay feed, which
 * can PLACE it instead of blocking it (lib/geo/privateRelayRanges holds the
 * rule). The feed is fetched from our own route only when a client has already
 * been judged anonymized, so ordinary visitors never cost that call.
 */
async function anonymizedClient(request: NextRequest): Promise<VpnStatus> {
  return vpnStatusFromHeaders(request.headers, {
    // NOT request.nextUrl.origin: on Railway that is the bind address
    // (https://0.0.0.0:8080), which a client cannot reach — the first deploy of
    // this logged "fetch failed" and every relay user stayed blocked. The same
    // trap, and the same helper, as lib/api/proxy-adapter.
    relayRanges: () => getRelayRangeSetEdge(getServedOrigin(request)),
  })
}

/** The state of a Private Relay client that was placed rather than blocked, else null. */
function placedRelayState(vpn: VpnStatus | null | undefined): string | null {
  return vpn && !vpn.blocked && vpn.relayState ? vpn.relayState : null
}

const RELAY_PAID_MESSAGE =
  "Paid features can't be used over iCloud Private Relay where you are, because in your time zone it can hide which state you're in. Free features still work. Turn off Private Relay for this site to use paid features."

/** The owner bypass the geo gates honour. Decodes the session only when asked. */
async function isOwnerRequest(request: NextRequest): Promise<boolean> {
  const authSecret = resolveAuthSecret()
  if (!authSecret) return false
  const token = await getToken({ req: request, secret: authSecret })
  return isMiddlewareAdmin(typeof token?.sub === "string" ? token.sub : null)
}

const VPN_BLOCKED_MESSAGE =
  "AllFantasy.ai can't be used over a VPN, proxy, Tor or iCloud Private Relay, because we have to confirm which state you're in. Turn it off and try again."

/**
 * 403 VPN_BLOCKED for an API request from an anonymized client, else null.
 *
 * Skipped for: machine credentials (checked by the caller, first), exempt
 * paths, and a verified internal hop — our own server calling itself back
 * through Cloudflare, which stamps the hop with Railway's data-centre address.
 * The person's own request has already been through this gate by then.
 */
async function apiVpnRefusal(
  request: NextRequest,
  pathname: string,
): Promise<{ refusal: NextResponse | null; vpn: VpnStatus | null }> {
  if (isVpnExemptApi(pathname)) return { refusal: null, vpn: null }
  if (
    request.headers.has(INTERNAL_HOP_HEADER) &&
    (await verifyInternalHop(request.headers, request.method, pathname))
  ) {
    return { refusal: null, vpn: null }
  }
  const vpn = await anonymizedClient(request)
  // A Mountain-time relay user is placed, but kept off paid surfaces — the same
  // 451 shape the paid-block states get, so paid clients already handle it.
  const relayPaidRefusal = !vpn.blocked && vpn.paidBlocked === true && isPaidRoute(pathname)
  if (!vpn.blocked && !relayPaidRefusal) return { refusal: null, vpn }
  if (await isOwnerRequest(request)) return { refusal: null, vpn }
  if (relayPaidRefusal) {
    return {
      refusal: new NextResponse(
        JSON.stringify({
          error: "PAID_GEO_BLOCKED",
          reason: "private_relay",
          kind: "privacy_relay",
          message: RELAY_PAID_MESSAGE,
          allowFree: true,
          redirectTo: "/vpn-blocked?why=privacy_relay&scope=paid",
        }),
        { status: 451, headers: { "Content-Type": "application/json", ...API_EDGE_SECURITY_HEADERS } },
      ),
      vpn,
    }
  }
  return {
    refusal: new NextResponse(
      JSON.stringify({ error: "VPN_BLOCKED", kind: vpn.kind, message: VPN_BLOCKED_MESSAGE, redirectTo: "/vpn-blocked" }),
      { status: 403, headers: { "Content-Type": "application/json", ...API_EDGE_SECURITY_HEADERS } },
    ),
    vpn,
  }
}

/** Redirect to /vpn-blocked for a non-public page from an anonymized client, else null. */
async function pageVpnRedirect(
  request: NextRequest,
  pathname: string,
  tokenUserId: string | null,
): Promise<{ redirect: NextResponse | null; vpn: VpnStatus | null }> {
  if (isVpnPublicPage(pathname)) return { redirect: null, vpn: null }
  if (isAnonymousCrawler(request)) return { redirect: null, vpn: null }
  if (hasMachineCredential(request.headers)) return { redirect: null, vpn: null }
  const vpn = await anonymizedClient(request)
  const relayPaidRefusal = !vpn.blocked && vpn.paidBlocked === true && isPaidRoute(pathname)
  if (!vpn.blocked && !relayPaidRefusal) return { redirect: null, vpn }
  // tokenUserId is only decoded on session-gated paths; decode it here otherwise.
  if (tokenUserId ? isMiddlewareAdmin(tokenUserId) : await isOwnerRequest(request)) return { redirect: null, vpn }
  const url = request.nextUrl.clone()
  url.pathname = "/vpn-blocked"
  url.search = ""
  url.searchParams.set("from", `${pathname}${request.nextUrl.search}`)
  // So the page can say WHAT is on — "iCloud Private Relay is still on" is the
  // answer a person who already switched their VPN off needs.
  if (vpn.kind) url.searchParams.set("why", vpn.kind)
  // A Mountain-time relay user: free pages load, paid ones need the relay off.
  if (relayPaidRefusal) url.searchParams.set("scope", "paid")
  const response = NextResponse.redirect(url)
  response.headers.set("Cache-Control", "private, no-store, max-age=0")
  return { redirect: response, vpn }
}

// ─── The account lock ────────────────────────────────────────────────────────
/*
 * An account seen in Washington on a normal connection stays locked from
 * anywhere, until support unlocks it (lib/geo/accountGeoLock). This is the one
 * gate an undetected residential proxy cannot beat: it reads where the ACCOUNT
 * has been, not where this request appears to be. The jwt callback stamps
 * `geoLock` onto the session token from the database; this only reads it.
 *
 * Still reachable while locked: everything isExemptPath allows (legal pages, the
 * block pages, /api/auth so sign-out works, crons, webhooks), machine APIs, and
 * the billing portal — cancelling must never depend on the lock being lifted.
 *
 * The CARD lock (`card_paid_block`) is narrower: a purchase whose card billing
 * address was in a restricted state was refunded, and the account is kept off
 * the paid surfaces only (isPaidRoute) — the same surfaces a paid-block state's
 * IP is kept off, from anywhere. Free features stay open.
 */
const ACCOUNT_LOCK_EXEMPT_API_PREFIXES = ["/api/subscription/billing-portal"]

function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((c) => c.name.includes("next-auth.session-token") || c.name.includes("authjs.session-token"))
}

type AccountLock = "full_block" | "card_paid_block" | null

/** The signed-in account's lock, or null for none / the owner. Decodes the session only when a session cookie exists. */
async function accountGeoLockOf(request: NextRequest): Promise<AccountLock> {
  if (!hasSessionCookie(request)) return null
  const authSecret = resolveAuthSecret()
  if (!authSecret) return null
  const token = await getToken({ req: request, secret: authSecret })
  const lock = token?.geoLock
  if (lock !== "full_block" && lock !== "card_paid_block") return null
  return isMiddlewareAdmin(typeof token?.sub === "string" ? token.sub : null) ? null : lock
}

const ACCOUNT_LOCKED_MESSAGE =
  "This account can't be used because it has been used in Washington, or paid with a card billed there, and AllFantasy.ai isn't available in Washington. If that's wrong, email support@allfantasy.ai."

async function apiAccountLockRefusal(request: NextRequest, pathname: string): Promise<NextResponse | null> {
  if (isFullBlockApiExempt(pathname)) return null
  if (ACCOUNT_LOCK_EXEMPT_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null
  const lock = await accountGeoLockOf(request)
  if (lock === "full_block") {
    return new NextResponse(
      JSON.stringify({ error: "GEO_BLOCKED", reason: "account", message: ACCOUNT_LOCKED_MESSAGE, redirectTo: "/geo-blocked?reason=account" }),
      { status: 403, headers: { "Content-Type": "application/json", ...API_EDGE_SECURITY_HEADERS } },
    )
  }
  if (lock === "card_paid_block" && isPaidRoute(pathname)) {
    return new NextResponse(
      JSON.stringify({
        error: "PAID_GEO_BLOCKED",
        reason: "billing_address",
        message: CARD_PAID_LOCK_MESSAGE,
        allowFree: true,
        redirectTo: CARD_PAID_LOCK_REDIRECT,
      }),
      { status: 451, headers: { "Content-Type": "application/json", ...API_EDGE_SECURITY_HEADERS } },
    )
  }
  return null
}

async function pageAccountLockRedirect(request: NextRequest, pathname: string): Promise<NextResponse | null> {
  const lock = await accountGeoLockOf(request)
  if (lock === "full_block") {
    const url = request.nextUrl.clone()
    url.pathname = "/geo-blocked"
    url.search = ""
    url.searchParams.set("reason", "account")
    return NextResponse.redirect(url)
  }
  if (lock === "card_paid_block" && isPaidRoute(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = "/paid-restricted"
    url.search = ""
    url.searchParams.set("reason", "billing")
    return NextResponse.redirect(url)
  }
  return null
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 🛑 THE GEO GATE FOR /api/*, WHICH NEVER RAN BEFORE #1204. routeMiddleware
 * returns early for every API path long before the page geo block, so every API
 * answered every restricted state normally.
 *
 *   - Washington (full block): 403 GEO_BLOCKED on every API that is not exempt.
 *   - Paid-block states: 451 PAID_GEO_BLOCKED on paid routes only.
 *
 * ⚠ MACHINE CALLERS ARE EXEMPTED BY CREDENTIAL, NOT BY PATH. A census on
 * 2026-09-24 found 65 API routes outside GEO_EXEMPT_PREFIXES that accept a
 * machine secret — 10 of them scheduled from GitHub Actions, which runs in
 * Azure West US 2, in Washington. A request that proves it holds a machine
 * secret (lib/http/machineCredential) is not a person, wherever its IP is, and
 * the check runs BEFORE any location lookup so a cron never costs a vendor call.
 * A person in Washington holds no such secret and is refused everywhere.
 *
 * The session is decoded only for a request that would be refused, to honour
 * the same owner bypass the page gate has.
 */
async function apiGeoRefusal(request: NextRequest, pathname: string): Promise<NextResponse | null> {
  if (hasMachineCredential(request.headers)) return null
  // Before the geo exemptions and the `country !== "US"` early return below: a
  // VPN is refused wherever its exit is, and /api/auth sign-in is refused too.
  const { refusal: vpnRefusal, vpn } = await apiVpnRefusal(request, pathname)
  if (vpnRefusal) return vpnRefusal
  if (isExemptPath(pathname)) return null
  // Wherever this request appears to be: the lock follows the account.
  const lockRefusal = await apiAccountLockRefusal(request, pathname)
  if (lockRefusal) return lockRefusal

  const { country, region } = await resolveRequestGeo(request, vpn)
  if (country !== "US" || !region) return null
  const fullBlock = isFullyBlocked(region) && !isFullBlockApiExempt(pathname)
  const paidBlock = !fullBlock && isPaidRoute(pathname) && (isPaidBlocked(region) || isFullyBlocked(region))
  if (!fullBlock && !paidBlock) return null

  const authSecret = resolveAuthSecret()
  if (authSecret) {
    const token = await getToken({ req: request, secret: authSecret })
    if (isMiddlewareAdmin(typeof token?.sub === "string" ? token.sub : null)) return null
  }

  const body = fullBlock
    ? { error: "GEO_BLOCKED", message: "AllFantasy.ai is not available in your state.", stateCode: region }
    : {
        error: "PAID_GEO_BLOCKED",
        message: "Paid features are not available in your state.",
        stateCode: region,
        allowFree: true,
        redirectTo: "/paid-restricted",
      }
  return new NextResponse(JSON.stringify(body), {
    status: fullBlock ? 403 : 451,
    headers: { "Content-Type": "application/json", ...API_EDGE_SECURITY_HEADERS },
  })
}

/**
 * Legacy `/web` mirror → canonical fantasy shell.
 */
function redirectDeprecatedWebRoutes(request: NextRequest): NextResponse | null {
  const url = request.nextUrl.clone()
  const { pathname } = url
  if (pathname === "/web" || pathname === "/web/" || pathname.startsWith("/web/")) {
    url.pathname = "/core"
    return NextResponse.redirect(url)
  }
  return null
}

/**
 * Singular `/bracket/*` → `/brackets/*` (canonical bracket challenge UI).
 */
function redirectDeprecatedBracketSingularRoutes(request: NextRequest): NextResponse | null {
  const url = request.nextUrl.clone()
  const { pathname } = url

  if (pathname === "/bracket" || pathname === "/bracket/") {
    url.pathname = "/brackets"
    return NextResponse.redirect(url)
  }
  if (pathname === "/bracket/home" || pathname.startsWith("/bracket/home/")) {
    url.pathname = "/brackets"
    return NextResponse.redirect(url)
  }

  const entriesNew = pathname.match(/^\/bracket\/([^/]+)\/entries\/new\/?$/)
  if (entriesNew) {
    url.pathname = `/brackets/tournament/${entriesNew[1]}`
    return NextResponse.redirect(url)
  }

  const entryView = pathname.match(/^\/bracket\/([^/]+)\/entry\/([^/]+)\/?$/)
  if (entryView) {
    url.pathname = `/brackets/tournament/${entryView[1]}`
    return NextResponse.redirect(url)
  }

  if (pathname.startsWith("/bracket/")) {
    url.pathname = `/brackets${pathname.slice("/bracket".length)}`
    return NextResponse.redirect(url)
  }

  return null
}

/**
 * Legacy marketing `/app` entry and a few moved routes. Other `/app/*` pages still live under
 * `app/app/**` (e.g. `/app/notifications`) — do not blanket-strip `/app` or those URLs 404.
 */
function redirectDeprecatedAppRoutes(request: NextRequest): NextResponse | null {
  const url = request.nextUrl.clone()
  const { pathname } = url

  if (pathname === "/app" || pathname === "/app/") {
    url.pathname = "/core"
    return NextResponse.redirect(url)
  }
  if (pathname.startsWith("/app/leagues")) {
    url.pathname = pathname.replace(/^\/app/, "")
    return NextResponse.redirect(url)
  }
  if (pathname.startsWith("/app/power-rankings")) {
    url.pathname = pathname.replace(/^\/app/, "")
    return NextResponse.redirect(url)
  }
  const leagueRoot = pathname.match(/^\/app\/league\/([^/]+)$/)
  if (leagueRoot) {
    url.pathname = `/league/${leagueRoot[1]}`
    return NextResponse.redirect(url)
  }
  if (pathname === "/app/discover" || pathname.startsWith("/app/discover/")) {
    // Bare /discover has no page — the discovery surface lives at /discover/leagues.
    const stripped = pathname.replace(/^\/app/, "")
    url.pathname = stripped === "/discover" || stripped === "/discover/" ? "/discover/leagues" : stripped
    return NextResponse.redirect(url)
  }
  return null
}

/**
 * `/dashboard` retires behind `/core` — the canonical signed-in home (P2-3).
 * Blanket `/dashboard(/*)` redirect that preserves the query string: `?league=`
 * is the league-scoped state of the home screen on both routes. The two live
 * non-home sub-surfaces that still have pages (`/dashboard/admin/*`,
 * `/dashboard/dispersal`) are exempt, and `/dashboard/brackets/world-cup/*`
 * never reaches here — next.config redirects run before middleware.
 */
function redirectDeprecatedDashboardRoutes(request: NextRequest): NextResponse | null {
  const url = request.nextUrl.clone()
  const { pathname } = url
  if (pathname !== "/dashboard" && !pathname.startsWith("/dashboard/")) return null
  if (pathname.startsWith("/dashboard/admin") || pathname.startsWith("/dashboard/dispersal")) {
    return null
  }
  url.pathname = "/core"
  return NextResponse.redirect(url)
}

function redirectLegacyMarketingRoutes(request: NextRequest): NextResponse | null {
  const web = redirectDeprecatedWebRoutes(request)
  if (web) return web
  const bracket = redirectDeprecatedBracketSingularRoutes(request)
  if (bracket) return bracket
  const dashboard = redirectDeprecatedDashboardRoutes(request)
  if (dashboard) return dashboard
  return redirectDeprecatedAppRoutes(request)
}

/**
 * Permanent app-owner / developer accounts that bypass geo-restrictions.
 * Mirror of STATIC_ADMIN_USER_IDS in lib/dev-admin/access.ts.
 * Keep in sync manually — this lives here to stay Edge-runtime-safe.
 */
const MIDDLEWARE_ADMIN_USER_IDS = new Set<string>([
  '944bb9f1-7a25-455b-8ef2-66146dbf3553', // theciege24 — app owner
  '3a7ffd10-b1a5-4a40-8d07-232364596735', // TheCiege24 — current app owner account
])

function parseMiddlewareAdminIds(rawValue: string | undefined): Set<string> {
  if (!rawValue) return new Set()
  return new Set(
    rawValue.split(/[\n\r,;]+/).map((v) => v.trim()).filter(Boolean)
  )
}

function isMiddlewareAdmin(userId: string | null | undefined): boolean {
  const id = String(userId ?? '').trim()
  if (!id) return false
  if (MIDDLEWARE_ADMIN_USER_IDS.has(id)) return true
  return parseMiddlewareAdminIds(process.env.DEV_ADMIN_USER_IDS).has(id)
}

/** Replaces next.config `headers` for `/api/:path*` — that pattern explodes to one Vercel rule per API route (>2048 cap). */
const API_EDGE_SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "X-Content-Type-Options": "nosniff",
}

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/")
}

function applyApiSecurityHeaders(pathname: string, response: NextResponse): NextResponse {
  if (!isApiPath(pathname)) return response
  for (const [key, value] of Object.entries(API_EDGE_SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }
  return response
}

/**
 * Exported for `__tests__/middleware-lang-prefetch.test.ts`. The alternative is driving the whole
 * `middleware()` chain — geo redirects, host canonicalisation, the username gate — to observe one
 * `Set-Cookie`, which tests the routing far more than the thing under test.
 */
export function nextWithRouteHeaders(request: NextRequest, pathname: string): NextResponse {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-af-pathname", pathname)

  /*
   * ⚠ ?lang= MUST REACH <html lang> ON THE FIRST RENDER. The root layout reads
   * the af_lang COOKIE (layouts cannot see searchParams), so the Spanish
   * landing at /?lang=es served lang="en" until this override: rewrite the
   * request's cookie header so this render resolves the requested language,
   * and stamp the response cookie so it sticks. Selectable languages only —
   * an arbitrary value must not reach the html attribute.
   */
  const langParam = request.nextUrl.searchParams.get("lang")
  const validLang =
    langParam && (SELECTABLE_LANGUAGES as readonly string[]).includes(langParam) ? langParam : null
  if (validLang) {
    const cookieHeader = requestHeaders.get("cookie") ?? ""
    const kept = cookieHeader.split(/;\s*/).filter((c) => c && !c.startsWith("af_lang="))
    kept.push(`af_lang=${validLang}`)
    requestHeaders.set("cookie", kept.join("; "))
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
  /*
   * ── 🛑 A PREFETCH IS NOT A CHOICE, AND THIS COOKIE LASTS A YEAR ─────────────────────────────
   *
   * `LandingV4`'s language switch is a next/link to `/?lang=es`, so the App Router prefetches it
   * the moment it enters the viewport. That prefetch reaches this function, which stamped
   * `af_lang=es` for 365 days — and every later page server-renders from the cookie. A
   * first-time English visitor was switched to Spanish site-wide without clicking anything.
   *
   * Measured against production 2026-09-01, before the fix:
   *
   *     GET /?lang=es                            → Set-Cookie: af_lang=es; Max-Age=31536000
   *     GET /?lang=es  Next-Router-Prefetch: 1   → Set-Cookie: af_lang=es; Max-Age=31536000
   *     GET /            (control, no param)     → no cookie
   *
   * The control matters: it is what proves the check can report a negative, so the identical
   * second line is a real finding rather than a probe that stamps everything.
   *
   * ⚠ ONLY THE RESPONSE COOKIE IS SKIPPED — THE REQUEST REWRITE ABOVE STILL RUNS, DELIBERATELY.
   * A prefetch must still RENDER the requested language, because that payload goes into the
   * router cache and is what the user sees if they do click. Skipping both would trade a
   * wrong-language visitor for a wrong-language flash on the very click that asked for it.
   * Render in Spanish, remember nothing: the switch stays universal for anyone who chooses it,
   * and costs nothing to anyone who does not.
   *
   * ⚠ `RSC: 1` ALONE IS NOT A PREFETCH. A real client-side navigation is also an RSC request;
   * only `Next-Router-Prefetch` distinguishes them, so gating on `RSC` would break the switch
   * for every soft navigation. Verified before the change: an RSC request WITHOUT the prefetch
   * header stamps, and must go on stamping.
   *
   * `Sec-Purpose` and `Purpose` cover browser-initiated speculation, which arrives without any
   * Next header at all.
   */
  if (validLang && !isSpeculativeRequest(request)) {
    response.cookies.set("af_lang", validLang, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    })
  }
  return response
}

/**
 * A request the user did not ask for: a Next router prefetch, or browser speculation.
 *
 * ⚠ THE PREDICATE MOVED TO `lib/http/speculativeRequest.ts` AND THIS IS NOW A THIN ADAPTER.
 * A second caller needs it — a server component, which has `headers()` and no `NextRequest` —
 * and writing a small copy there is how two implementations of one rule start. The behaviour is
 * unchanged and `__tests__/middleware-lang-prefetch.test.ts` still pins it from this side.
 */
/**
 * `/core?leagueFirst=on|off` — the per-browser switch for the league-first phone shell
 * (lib/core-app/leagueFirst.ts). Stores the choice in a cookie and redirects to the same URL
 * without the parameter, so the switch is not left in a shareable link.
 *
 * ⚠ NEVER ON A PREFETCH — the af_lang lesson above: a prefetched `?leagueFirst=on` link would
 * flip the shell for someone who only scrolled past it. A prefetch gets no cookie and no redirect.
 */
function leagueFirstToggleRedirect(request: NextRequest): NextResponse | null {
  const { pathname, searchParams } = request.nextUrl
  if (pathname !== "/core" && !pathname.startsWith("/core/")) return null
  const toggle = parseLeagueFirstToggle(searchParams.get(LEAGUE_FIRST_PARAM))
  if (!toggle || isSpeculativeRequest(request)) return null
  const url = request.nextUrl.clone()
  url.searchParams.delete(LEAGUE_FIRST_PARAM)
  const response = NextResponse.redirect(url)
  response.cookies.set(LEAGUE_FIRST_COOKIE, toggle, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  })
  return response
}

function isSpeculativeRequest(request: NextRequest): boolean {
  return isSpeculativeRequestHeaders(request.headers)
}

/**
 * Campaign attribution is applied by the `middleware` wrapper below rather than inside
 * `routeMiddleware`, which has ~10 distinct return points (geo redirects, host
 * canonicalization, the username gate, `/` → `/dashboard`). Stamping cookies at a single
 * choke point means a new redirect added later cannot silently drop attribution.
 */
export async function middleware(request: NextRequest) {
  // ⚠ FIRST, AHEAD OF THE /api EARLY EXIT: a request that bypassed Cloudflare
  // carries forgeable cf-* headers, and every geo gate and rate limit below
  // trusts them. Off unless CF_ORIGIN_AUTH_SECRET is set — see lib/http/originLock.
  const lock = checkOriginLock(request.headers, request.nextUrl.pathname)
  if (lock.action !== "allow") {
    const host = request.headers.get("host")
    const { pathname, search } = request.nextUrl
    if (lock.action === "report") {
      reportOriginLock(lock.reason, host, pathname, "would-refuse")
    } else {
      // Pages on a non-canonical host are sent back through Cloudflare; everything
      // else is refused. The rules, and why, are in originLockRefusal.
      const refusal = originLockRefusal({ method: request.method, pathname, search, host }, getPublicSiteHostname())
      reportOriginLock(lock.reason, host, pathname, refusal.kind === "redirect" ? "redirected" : "refused")
      if (refusal.kind === "redirect") return NextResponse.redirect(refusal.location, 308)
      return new NextResponse("Forbidden", { status: 403, headers: { "content-type": "text/plain", "cache-control": "no-store" } })
    }
  }

  const response = await routeMiddleware(request)
  return applyAttributionCapture(request, response)
}

async function routeMiddleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const iosRefusal = iosAppPurchaseRefusal(request, pathname)
  if (iosRefusal) return applyApiSecurityHeaders(pathname, iosRefusal)
  const iosLanding = await iosAppSignedOutLanding(request, pathname)
  if (iosLanding) return iosLanding

  // ── Hard early-exit for all API routes ───────────────────────────────────
  // UI redirect logic (username gate, geo redirect, /choose-username, etc.)
  // must NEVER produce HTML responses for /api/* — that path historically
  // caused JSON consumers to receive HTML and the diagnostic 404 page to
  // render the global app shell (Meta Pixel + FB SDK), which DOM-mutates
  // during React hydration and crashes the page (#418/#423 +
  // HierarchyRequestError + removeChild on Node). API-level auth, geo, and
  // username checks live in the route handlers themselves; the middleware
  // only stamps standard security headers on API responses.
  if (isApiPath(pathname)) {
    const geoRefusal = await apiGeoRefusal(request, pathname)
    if (geoRefusal) return geoRefusal
    return applyApiSecurityHeaders(pathname, nextWithRouteHeaders(request, pathname))
  }

  if (isExemptPath(pathname)) {
    return applyApiSecurityHeaders(pathname, nextWithRouteHeaders(request, pathname))
  }

  const hostRedirect = canonicalProductionHostRedirect(request)
  if (hostRedirect) {
    return hostRedirect
  }

  const leagueFirstToggle = leagueFirstToggleRedirect(request)
  if (leagueFirstToggle) {
    return leagueFirstToggle
  }

  const legacyRedirect = redirectLegacyMarketingRoutes(request)
  if (legacyRedirect) {
    return legacyRedirect
  }

  /*
   * ⚠ `/` NO LONGER REDIRECTS ANYONE TO /dashboard, AND THAT IS THE FIX FOR
   * "TYPING allfantasy.ai SHOWS THE LOGIN PAGE".
   *
   * This branch used to send any request carrying `token.sub` to /dashboard. The
   * trouble is that three different places each decided "signed in" differently:
   *
   *   here                       `token.sub`                  — set by next-auth ALWAYS
   *   app/page.tsx               `session.user`               — always truthy alongside a token
   *   app/dashboard/page.tsx     `session.user.id` non-empty  — only set by the jwt callback
   *
   * `token.id` is assigned in exactly one place (lib/auth.ts, `token.id = user.id`)
   * and only on the sign-in event. Any session token that predates that line, or
   * any refresh where `user` is absent, therefore carries `sub` WITHOUT `id`. Such
   * a visitor was redirected here to /dashboard, rejected there for having no
   * usable id, and forwarded to /login — so entering the domain produced a login
   * form, permanently, because every reload of `/` repeated the trip. Reproduced
   * end to end: `/` → `/dashboard` → `/login`, two redirects, title "Sign In".
   *
   * Serving the marketing page unconditionally removes the trip entirely. A
   * signed-in reader is offered their dashboard by the landing nav instead of
   * being redirected into it — see app/page.tsx.
   *
   * The guest-trial cookie still has to be cleared for an authenticated visitor,
   * which the redirect used to do on its way out; it now rides on the pass-through
   * response at the end of this function.
   */
  let clearGuestTrialOnPassThrough = false
  if (pathname === "/" || pathname === "") {
    const authSecret = resolveAuthSecret()
    if (authSecret) {
      const token = await getToken({ req: request, secret: authSecret })
      if (token?.sub) {
        clearGuestTrialOnPassThrough = true
      }
    }
  }

  // Username gate: redirect authenticated users without a username to /choose-username.
  // This fires for OAuth sign-ups where the user never had a chance to pick a username.
  // API routes get a 403 JSON; page routes get a redirect.
  if (!isUsernameGateExempt(pathname)) {
    const gateSecret = resolveAuthSecret()
    if (gateSecret) {
      const gateToken = await getToken({ req: request, secret: gateSecret })
      if (gateToken && !gateToken.username) {
        if (pathname.startsWith("/api/")) {
          return applyApiSecurityHeaders(
            pathname,
            NextResponse.json(
              {
                error: "USERNAME_REQUIRED",
                message: "Please choose a username before continuing.",
              },
              { status: 403 }
            )
          )
        }
        const dest = request.nextUrl.clone()
        dest.pathname = "/choose-username"
        dest.searchParams.set(
          "callbackUrl",
          pathname + (request.nextUrl.search || "")
        )
        return clearGuestTrialCookie(request, NextResponse.redirect(dest))
      }
    }
  }

  const authSecret = resolveAuthSecret()
  let tokenUserId: string | null = null
  if (authSecret && requiresSessionAuth(pathname)) {
    const token = await getToken({ req: request, secret: authSecret })
    if (!token) {
      if (pathname.startsWith("/api/")) {
        return applyApiSecurityHeaders(pathname, NextResponse.json({ error: "Unauthorized" }, { status: 401 }))
      }
      const login = request.nextUrl.clone()
      login.pathname = "/login"
      login.searchParams.set("callbackUrl", `${pathname}${request.nextUrl.search}`)
      return NextResponse.redirect(login)
    }
    tokenUserId = typeof token.sub === 'string' ? token.sub : null
  }

  // Pages only: every /api/* path returned near the top of this function, and
  // API routes are gated there by apiGeoRefusal, from the same helpers.
  const { ip, country, region } = await resolveRequestGeo(request)

  if (country === "US" && region && !isMiddlewareAdmin(tokenUserId) && isFullyBlocked(region)) {
    const url = request.nextUrl.clone()
    url.pathname = "/geo-blocked"
    url.searchParams.set("state", region)
    return NextResponse.redirect(url)
  }

  // Outside the `country === "US"` guard on purpose: a VPN exit abroad is the
  // cheapest way around every state rule. Public pages load; nothing else does.
  // Before the VPN check, so a locked account on a VPN is told the real reason.
  const lockRedirect = await pageAccountLockRedirect(request, pathname)
  if (lockRedirect) return lockRedirect

  const { redirect: vpnRedirect, vpn } = await pageVpnRedirect(request, pathname, tokenUserId)
  if (vpnRedirect) return vpnRedirect

  // A placed Private Relay client is judged by Apple's state from here on — it
  // is the state the paid rule and the x-user-state header describe.
  const relayState = placedRelayState(vpn)
  const effectiveCountry = relayState ? "US" : country
  const effectiveRegion = relayState ?? region

  if (effectiveCountry === "US" && effectiveRegion && !isMiddlewareAdmin(tokenUserId)) {
    const stateCode = effectiveRegion

    if (isPaidBlocked(stateCode) && isPaidRoute(pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = "/paid-restricted"
      url.searchParams.set("state", stateCode)
      return NextResponse.redirect(url)
    }
  }

  const response = nextWithRouteHeaders(request, pathname)
  // Carried over from the `/` → /dashboard redirect this replaced: an
  // authenticated visitor's trial token is invalidated even though they are no
  // longer being redirected anywhere. No-op when the cookie is absent.
  if (clearGuestTrialOnPassThrough) {
    clearGuestTrialCookie(request, response)
  }
  if (effectiveCountry === "US" && effectiveRegion) {
    response.headers.set("x-user-state", effectiveRegion)
  }
  if (ip) {
    response.headers.set("x-client-ip", ip)
  }
  return applyApiSecurityHeaders(pathname, response)
}

/**
 * Runs on all non-static routes; session checks apply only to
 * /dashboard/rankings, /league/* (see requiresSessionAuth).
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
