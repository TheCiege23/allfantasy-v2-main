/**
 * ProtectedRouteResolver — which paths require auth or admin; login redirect URL for protected routes.
 */

import {
  resolveLoginHrefFromRequestedPath,
  resolveSignupHrefFromRequestedPath,
} from "@/lib/auth/AuthRedirectResolver"

/** Path prefixes that require an authenticated session. */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/discover",
  "/leagues",
  "/brackets",
  "/af-legacy",
  "/legacy",
  "/profile",
  "/settings",
  "/wallet",
  "/messages",
  "/onboarding",
  "/mock-draft",
  "/mock-draft-simulator",
  "/trade-finder",
  "/trade-history",
  "/dynasty-trade-analyzer",
  "/startup-dynasty",
  "/legacy-import",
  "/verify",
  "/bracket-intelligence",
  "/lab",
]

/** Path prefixes that require admin (in addition to auth). */
const ADMIN_PREFIXES = ["/admin"]

export function isProtectedPath(pathname: string | null): boolean {
  if (!pathname || pathname === "/") return false
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )
}

export function isAdminPath(pathname: string | null): boolean {
  if (!pathname) return false
  return ADMIN_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )
}

/** Build login redirect URL that preserves the requested path as callbackUrl. */
export function getLoginRedirectUrl(requestedPath: string | null): string {
  const path = requestedPath && requestedPath.startsWith("/") && !requestedPath.startsWith("//")
    ? requestedPath
    : "/dashboard"
  return resolveLoginHrefFromRequestedPath(path)
}

/**
 * Build the admin-only login redirect URL (`/admin-login?next=<path>`).
 * Restricts `next` to /admin paths — anything else is coerced to `/admin`.
 */
export function getAdminLoginRedirectUrl(requestedPath: string | null): string {
  let next = "/admin"
  if (
    requestedPath &&
    requestedPath.startsWith("/admin") &&
    !requestedPath.startsWith("//")
  ) {
    next = requestedPath
  }
  return `/admin-login?next=${encodeURIComponent(next)}`
}

/** Build signup redirect URL that preserves the requested path as next. */
export function getSignupRedirectUrl(requestedPath: string | null): string {
  const path = requestedPath && requestedPath.startsWith("/") && !requestedPath.startsWith("//")
    ? requestedPath
    : "/dashboard"
  return resolveSignupHrefFromRequestedPath(path)
}

/**
 * Resolve redirect target for protected routes.
 * - unauthenticated -> login redirect with callback
 * - authenticated non-admin on admin path -> dashboard
 * - otherwise no redirect (null)
 */
export function resolveProtectedRouteRedirect(input: {
  requestedPath: string | null
  isAuthenticated: boolean
  isAdmin: boolean
}): string | null {
  if (!input.isAuthenticated && isProtectedPath(input.requestedPath)) {
    return getLoginRedirectUrl(input.requestedPath)
  }
  if (isAdminPath(input.requestedPath) && input.isAuthenticated && !input.isAdmin) {
    return "/dashboard"
  }
  return null
}
