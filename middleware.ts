import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { getToken } from "next-auth/jwt"

import { resolveAuthSecret } from "@/lib/auth/resolve-auth-secret"
import { isFullyBlocked, isPaidBlocked } from "@/lib/geo/restrictedStates"
import { getPublicSiteHostname } from "@/lib/site-public-origin"

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
  return NextResponse.redirect(url, 308)
}

/**
 * App routes that must have a valid NextAuth session (JWT).
 * Matches: /af-rankings, /dashboard/rankings (redirect), /league/*
 */
function requiresSessionAuth(pathname: string): boolean {
  if (pathname.startsWith("/af-rankings")) return true
  if (pathname.startsWith("/dashboard/rankings")) return true
  if (pathname.startsWith("/league/")) return true
  return false
}

/** Paths that skip geo logic. Includes `/api/auth` so NextAuth + OAuth callbacks are never geo-blocked. */
const GEO_EXEMPT_PREFIXES = [
  "/geo-blocked",
  "/paid-restricted",
  "/restricted",
  "/terms",
  "/privacy",
  "/data-deletion",
  "/disclaimer",
  "/api/health",
  "/api/auth",
  "/api/geo",
  "/_next",
  "/favicon.ico",
]

/** Exact-prefix match: `/pro` matches `/pro` and `/pro/foo`, not `/professional`. */
function isPaidPrefix(prefix: string, pathname: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  const hostRedirect = canonicalProductionHostRedirect(request)
  if (hostRedirect) {
    return hostRedirect
  }

  const legacyRedirect = redirectLegacyMarketingRoutes(request)
  if (legacyRedirect) {
    return legacyRedirect
  }

  /** Signed-in users should land on the fantasy shell hub, not the marketing homepage. */
  if (pathname === "/" || pathname === "") {
    const authSecret = resolveAuthSecret()
    if (authSecret) {
      const token = await getToken({ req: request, secret: authSecret })
      if (token?.sub) {
        const url = request.nextUrl.clone()
        url.pathname = "/dashboard"
        return NextResponse.redirect(url)
      }
    }
  }

  if (isExemptPath(pathname)) {
    return applyApiSecurityHeaders(pathname, NextResponse.next())
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

  const response = NextResponse.next()
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
