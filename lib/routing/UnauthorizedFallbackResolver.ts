/**
 * UnauthorizedFallbackResolver — fallback route when access is denied (not logged in or not admin).
 */

import { getLoginRedirectUrl } from "./ProtectedRouteResolver"

/** Default fallback when user is authenticated but not admin (e.g. tried to open /admin). */
const DEFAULT_UNAUTHORIZED_FALLBACK = "/dashboard"

/**
 * Resolve where to send the user when access is denied.
 * - Not authenticated: login URL with callbackUrl so they can return after login.
 * - Authenticated but not admin (and path is admin): dashboard.
 */
export function getUnauthorizedFallback(
  isAuthenticated: boolean,
  isAdmin: boolean,
  requestedPath: string | null
): string {
  if (!isAuthenticated) {
    return getLoginRedirectUrl(requestedPath)
  }
  if (requestedPath?.startsWith("/admin") && !isAdmin) {
    return DEFAULT_UNAUTHORIZED_FALLBACK
  }
  return DEFAULT_UNAUTHORIZED_FALLBACK
}
