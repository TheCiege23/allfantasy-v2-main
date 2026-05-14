/**
 * Normalize user-facing navigation onto dashboard-era routes (Slice 8).
 * APIs may still exist; this is for browser redirects only.
 */

const DASHBOARD = "/dashboard"

function splitPathAndQuery(fullPath: string): { pathname: string; search: string } {
  const t = fullPath.trim()
  const q = t.indexOf("?")
  if (q === -1) return { pathname: t, search: "" }
  return { pathname: t.slice(0, q), search: t.slice(q) }
}

/**
 * Map legacy or cross-product paths to `/dashboard` or `/league/[leagueId]`.
 * External URLs and bare `/api/*` resolve to `/dashboard`.
 */
export function canonicalizeProductRoute(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return DASHBOARD
  if (/^https?:\/\//i.test(trimmed)) return DASHBOARD
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return DASHBOARD

  const { pathname, search } = splitPathAndQuery(trimmed)

  if (pathname.startsWith("/api")) return DASHBOARD

  const leagues = pathname.match(/^\/leagues\/([^/]+)\/?$/)
  if (leagues) return `/league/${leagues[1]}${search}`

  // Bracket pool paths must NEVER canonicalize to /league/[id].
  // /brackets/leagues/[id] and nested bracket paths are preserved as-is.
  // /bracket/leagues/[id] (singular) is normalized to /brackets/leagues/[id] via the /bracket→/brackets rewrite below.
  if (pathname === "/brackets" || pathname.startsWith("/brackets/")) return pathname + search

  if (pathname === "/app" || pathname.startsWith("/app/")) return DASHBOARD
  if (pathname === "/web" || pathname.startsWith("/web/")) return DASHBOARD
  if (pathname === "/bracket" || pathname.startsWith("/bracket/")) {
    return pathname.replace(/^\/bracket(\/|$)/, "/brackets$1") + search
  }
  if (pathname === "/af-legacy" || pathname.startsWith("/af-legacy/")) return DASHBOARD

  return pathname + search
}
