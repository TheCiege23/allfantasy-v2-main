/**
 * Post-credential-signup navigation: never land successful signups on auth shells,
 * and only honor explicit in-app return paths (Slice 8 — Neon/Prisma app; not Supabase).
 */

import { canonicalizeProductRoute } from "@/lib/routing/canonicalizeProductRoute"

export function pathnameFromPathAndQuery(pathAndQuery: string): string {
  const t = pathAndQuery.trim()
  const q = t.indexOf("?")
  return q === -1 ? t : t.slice(0, q)
}

/** Login, signup, NextAuth, and raw API paths must never be the post-signup landing target. */
export function isAuthEntrySurfacePathname(pathname: string): boolean {
  const p = pathname || "/"
  if (p === "/login" || p.startsWith("/login/")) return true
  if (p === "/signup" || p.startsWith("/signup/")) return true
  if (p.startsWith("/api")) return true
  return false
}

/**
 * Allowed relative destinations after successful credential signup (before optional /verify hop).
 * Rejects open redirects (caller must still enforce same-origin / leading slash).
 * Old product shells (/leagues, /brackets, /af-legacy, /app, /web) are not allowed here — use
 * {@link canonicalizeProductRoute} on resolved login/invite URLs instead.
 */
export function isAllowedSignupPostAuthDestination(
  pathAndQuery: string,
  isAdmin: boolean | undefined
): boolean {
  const pathname = pathnameFromPathAndQuery(pathAndQuery)
  if (isAuthEntrySurfacePathname(pathname)) return false
  if (pathname.startsWith("/leagues/")) return false
  // /brackets/* are valid post-auth destinations — bracket pool links must survive login redirects.
  // Do NOT block /brackets/leagues/[id] here; canonicalizeProductRoute now preserves these paths.
  if (pathname === "/af-legacy" || pathname.startsWith("/af-legacy/")) return false
  if (pathname === "/app" || pathname.startsWith("/app/")) return false
  if (pathname === "/web" || pathname.startsWith("/web/")) return false
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return true
  if (pathname.startsWith("/invite/")) return true
  if (pathname.startsWith("/join/")) return true
  if (pathname.startsWith("/verify")) return true
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return isAdmin !== false
  }
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) return true
  if (pathname === "/league" || pathname.startsWith("/league/")) return true
  return false
}

export function pathAndQueryFromMaybeAbsoluteUrl(maybeUrl: string): string {
  const t = maybeUrl.trim()
  try {
    const u = new URL(t)
    return u.pathname + u.search
  } catch {
    return t.startsWith("/") ? t : `/${t}`
  }
}

/**
 * NextAuth may return a URL that points at /login or /api/auth even when credentials succeeded.
 * Prefer a safe path+query for client navigation.
 */
export function pickPostCredentialSignupNavigation(
  signInResultUrl: string | null | undefined,
  callbackTarget: string
): string {
  const safeTarget = canonicalizeProductRoute(callbackTarget)
  if (!signInResultUrl) return safeTarget
  const pq = pathAndQueryFromMaybeAbsoluteUrl(signInResultUrl)
  if (!isAllowedSignupPostAuthDestination(pq, undefined)) return safeTarget
  return canonicalizeProductRoute(pq)
}
