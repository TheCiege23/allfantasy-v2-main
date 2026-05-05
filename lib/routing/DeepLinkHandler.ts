/**
 * DeepLinkHandler — normalize and validate deep link paths for cross-product routing.
 * Used by notifications, emails, and in-app links to ensure destinations are allowed and consistent.
 */

import { safeRedirectPath } from "./PostAuthIntentRouter"

/** Allowed path prefixes for deep links (no open redirect; must be internal). */
const ALLOWED_DEEP_LINK_PREFIXES = [
  "/dashboard",
  "/discover",
  "/leagues",
  "/web",
  "/app",
  "/bracket",
  "/brackets",
  "/af-legacy",
  "/legacy",
  "/profile",
  "/settings",
  "/wallet",
  "/messages",
  "/admin",
  "/tools-hub",
  "/tools/",
  "/chimmy",
  "/trade-analyzer",
  "/trade-evaluator",
  "/mock-draft",
  "/waiver-ai",
  "/verify",
  "/onboarding",
  "/login",
  "/signup",
  "/alerts",
  "/feed",
  "/podcast",
]

/**
 * Normalize a deep link path: ensure it starts with / and is not a full URL.
 * Returns the path if allowed, otherwise a safe default.
 */
export function normalizeDeepLink(path: string | null | undefined): string {
  const safe = safeRedirectPath(path)
  return safe
}

/**
 * Check if the path is an allowed deep link destination (internal app route).
 */
export function isAllowedDeepLink(path: string | null | undefined): boolean {
  if (path == null || typeof path !== "string") return false
  const trimmed = path.trim()
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return false
  const queryIndex = trimmed.indexOf("?")
  const pathOnly = queryIndex >= 0 ? trimmed.slice(0, queryIndex) : trimmed
  return ALLOWED_DEEP_LINK_PREFIXES.some(
    (p) => pathOnly === p || pathOnly.startsWith(`${p}/`)
  )
}

/**
 * Resolve redirect for a deep link: return normalized path if allowed, else default.
 */
export function getDeepLinkRedirect(
  path: string | null | undefined,
  defaultPath: string = "/dashboard"
): string {
  const normalizedDefault = isAllowedDeepLink(defaultPath)
    ? normalizeDeepLink(defaultPath)
    : "/dashboard"
  if (!isAllowedDeepLink(path)) return normalizedDefault
  const normalized = normalizeDeepLink(path)
  return isAllowedDeepLink(normalized) ? normalized : normalizedDefault
}
