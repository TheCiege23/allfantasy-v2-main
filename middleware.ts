import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"

import { resolveAuthSecret } from "@/lib/auth/resolve-auth-secret"
import { requiresSessionAuth } from "@/lib/auth/session-auth-paths"
import { isFullyBlocked, isPaidBlocked } from "@/lib/geo/restrictedStates"
import { getPublicSiteHostname } from "@/lib/site-public-origin"
import { GUEST_SESSION_COOKIE_NAME } from "@/lib/guest-mode/guestSessionToken"
import { applyAttributionCapture } from "@/lib/analytics/attributionCookies"

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

/** Paths that skip geo logic. Includes `/api/auth` so NextAuth + OAuth callbacks are never geo-blocked. */
const GEO_EXEMPT_PREFIXES = [
  "/geo-blocked",
  "/paid-restricted",
  "/restricted",
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
  "/_next",
  "/favicon.ico",
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

/**
 * Legacy `/web` mirror → canonical fantasy shell.
 */
function redirectDeprecatedWebRoutes(request: NextRequest): NextResponse | null {
  const url = request.nextUrl.clone()
  const { pathname } = url
  if (pathname === "/web" || pathname === "/web/" || pathname.startsWith("/web/")) {
    url.pathname = "/dashboard"
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
    url.pathname = "/dashboard"
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
    url.pathname = pathname.replace(/^\/app/, "")
    return NextResponse.redirect(url)
  }
  return null
}

function redirectLegacyMarketingRoutes(request: NextRequest): NextResponse | null {
  const web = redirectDeprecatedWebRoutes(request)
  if (web) return web
  const bracket = redirectDeprecatedBracketSingularRoutes(request)
  if (bracket) return bracket
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

function nextWithRouteHeaders(request: NextRequest, pathname: string): NextResponse {
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-af-pathname", pathname)
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })
}

/**
 * Campaign attribution is applied by the `middleware` wrapper below rather than inside
 * `routeMiddleware`, which has ~10 distinct return points (geo redirects, host
 * canonicalization, the username gate, `/` → `/dashboard`). Stamping cookies at a single
 * choke point means a new redirect added later cannot silently drop attribution.
 */
export async function middleware(request: NextRequest) {
  const response = await routeMiddleware(request)
  return applyAttributionCapture(request, response)
}

async function routeMiddleware(request: NextRequest) {
  const { pathname } = request.nextUrl

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
    return applyApiSecurityHeaders(pathname, nextWithRouteHeaders(request, pathname))
  }

  if (isExemptPath(pathname)) {
    return applyApiSecurityHeaders(pathname, nextWithRouteHeaders(request, pathname))
  }

  const hostRedirect = canonicalProductionHostRedirect(request)
  if (hostRedirect) {
    return hostRedirect
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

  const country = request.headers.get("x-vercel-ip-country")
  const region = request.headers.get("x-vercel-ip-country-region")
  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()

  if (country === "US" && region && !isMiddlewareAdmin(tokenUserId)) {
    const stateCode = region.toUpperCase()

    if (isFullyBlocked(stateCode)) {
      if (pathname.startsWith("/api/")) {
        return new NextResponse(
          JSON.stringify({
            error: "GEO_BLOCKED",
            message: "AllFantasy.ai is not available in your state.",
            stateCode,
          }),
          { status: 403, headers: { "Content-Type": "application/json", ...API_EDGE_SECURITY_HEADERS } },
        )
      }
      const url = request.nextUrl.clone()
      url.pathname = "/geo-blocked"
      url.searchParams.set("state", stateCode)
      return NextResponse.redirect(url)
    }

    if (isPaidBlocked(stateCode)) {
      const isPaidRoute =
        PAID_GEO_PREFIXES.some((p) => isPaidPrefix(p, pathname)) ||
        PAID_GEO_PATTERNS.some((r) => r.test(pathname))

      if (isPaidRoute && pathname.startsWith("/api/")) {
        return new NextResponse(
          JSON.stringify({
            error: "PAID_GEO_BLOCKED",
            message: "Paid features are not available in your state.",
            stateCode,
            allowFree: true,
            redirectTo: "/paid-restricted",
          }),
          { status: 451, headers: { "Content-Type": "application/json", ...API_EDGE_SECURITY_HEADERS } },
        )
      }

      if (isPaidRoute && !pathname.startsWith("/api/")) {
        const url = request.nextUrl.clone()
        url.pathname = "/paid-restricted"
        url.searchParams.set("state", stateCode)
        return NextResponse.redirect(url)
      }
    }
  }

  const response = nextWithRouteHeaders(request, pathname)
  // Carried over from the `/` → /dashboard redirect this replaced: an
  // authenticated visitor's trial token is invalidated even though they are no
  // longer being redirected anywhere. No-op when the cookie is absent.
  if (clearGuestTrialOnPassThrough) {
    clearGuestTrialCookie(request, response)
  }
  if (country === "US" && region) {
    response.headers.set("x-user-state", region.toUpperCase())
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
