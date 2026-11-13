/**
 * ProtectedRouteResolver — which paths require auth or admin; login redirect URL for protected routes.
 */

import { resolveLoginHrefFromRequestedPath } from "@/lib/auth/AuthRedirectResolver"
import { safeInternalPathOr } from "@/lib/auth/auth-intent-resolver"

/** Build login redirect URL that preserves the requested path as callbackUrl. */
export function getLoginRedirectUrl(requestedPath: string | null): string {
  const path = safeInternalPathOr(requestedPath, "/dashboard")
  return resolveLoginHrefFromRequestedPath(path)
}

