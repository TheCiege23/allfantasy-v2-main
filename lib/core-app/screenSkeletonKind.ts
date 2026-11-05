/**
 * Which placeholder shape a /core screen streams in behind (components/core-app/CoreScreenSkeleton.tsx).
 *
 * The skeleton used to be one generic card grid for every screen, on purpose: the boundary could not
 * know which screen was arriving. Two places now do know — the route's Suspense fallback (it has the
 * segment) and the pending-nav area (it has the link that was clicked) — so the placeholder can promise
 * the layout that actually lands, and nothing jumps when it is replaced.
 *
 * An unknown or missing screen keeps the generic cards: promising a table that then arrives as cards
 * is worse than promising nothing in particular.
 */
export type ScreenSkeletonKind = 'table' | 'scoreboard' | 'roster' | 'cards'

const KIND: Readonly<Record<string, ScreenSkeletonKind>> = {
  standings: 'table',
  rankings: 'table',
  waivers: 'table',
  'defense-hub': 'table',
  matchup: 'scoreboard',
  live: 'scoreboard',
  'my-team': 'roster',
}

export function skeletonKindForScreen(screen: string | null | undefined): ScreenSkeletonKind {
  if (!screen) return 'cards'
  return KIND[screen] ?? 'cards'
}

/** `/core/standings?league=x` → `standings`; `/core?league=x` → `home`; anything else → null. */
export function screenFromCorePath(path: string | null | undefined): string | null {
  if (!path) return null
  const relative = /^https?:\/\//i.test(path) ? path.replace(/^https?:\/\/[^/]+/i, '') : path
  const pathname = relative.split(/[?#]/)[0] ?? ''
  if (pathname === '/core' || pathname === '/core/') return 'home'
  const m = /^\/core\/([^/]+)/.exec(pathname)
  return m ? decodeURIComponent(m[1]) : null
}
