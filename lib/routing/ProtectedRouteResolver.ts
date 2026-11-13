/**
 * ProtectedRouteResolver — which paths require auth or admin; login redirect URL for protected routes.
 */

import { resolveLoginHrefFromRequestedPath } from "@/lib/auth/AuthRedirectResolver"
import { safeInternalPathOr } from "@/lib/auth/auth-intent-resolver"

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
  "/trade-history",
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
  const path = safeInternalPathOr(requestedPath, "/dashboard")
  return resolveLoginHrefFromRequestedPath(path)
}

