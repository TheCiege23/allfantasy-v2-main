/**
 * Swipe between leagues on a phone (founder, 2026-10-08).
 *
 * On /core?league=… (and the other league-scoped screens) a horizontal swipe on a phone moves to
 * the previous or next league in the rail's order, staying on the same screen: swiping on My team
 * lands on the next league's My team. The order is the rail's — the reader's own pinned and ranked
 * list — so the swipe never invents an ordering the page does not show.
 *
 * Pure and client-safe. LeagueSwipe.tsx owns the listeners; everything that decides lives here so
 * it can be tested without a touch screen.
 */

export type SwipeLeague = { id: string; name: string; imageUrl?: string | null; mark?: string }

/**
 * Screens where a swipe changes league. A screen that is ABOUT one league and reads the same for
 * any of them. Draft rooms, the commissioner desk and anything with its own horizontal gesture are
 * deliberately absent: a swipe there must never yank someone into another league mid-task.
 */
export const LEAGUE_SWIPE_SCREENS = new Set([
  'home',
  'my-team',
  'matchup',
  'trades',
  'waivers',
  'players',
  'week',
  'live',
  'standings',
  'season-outlook',
  'career',
])

export function neighborLeagues<T extends SwipeLeague>(
  leagues: readonly T[],
  selectedId: string | null | undefined,
): { prev: T | null; next: T | null; index: number; total: number } | null {
  if (!selectedId) return null
  const index = leagues.findIndex((l) => l.id === selectedId)
  if (index < 0 || leagues.length < 2) return null
  // No wrap: the first and last leagues are ends, so a swipe never silently jumps across the list.
  return {
    prev: index > 0 ? leagues[index - 1]! : null,
    next: index < leagues.length - 1 ? leagues[index + 1]! : null,
    index,
    total: leagues.length,
  }
}

/**
 * The same screen, another league. Only `league` is carried: any other parameter belongs to the
 * league being left (a focused trade, a player, a tab) and would be wrong — or a 404 — in the next.
 */
export function leagueSwipeHref(pathname: string, leagueId: string): string {
  const path = pathname && pathname.startsWith('/core') ? pathname : '/core'
  return `${path}?league=${encodeURIComponent(leagueId)}`
}

/** Distance a finger must travel sideways to switch, and how much straighter than vertical it must be. */
export const SWIPE_MIN_PX = 72
const SWIPE_AXIS_RATIO = 1.8
/** A slow drag reads as reading, not as a swipe. */
const SWIPE_MAX_MS = 700
/** Where iOS and Android put their own back/forward edge gestures. A swipe starting here is theirs. */
export const EDGE_GUARD_PX = 24

/** Left swipe (finger moves left) shows what is to the right — the next league. */
export function classifySwipe(g: { dx: number; dy: number; ms: number }): 'next' | 'prev' | null {
  if (g.ms > SWIPE_MAX_MS) return null
  if (Math.abs(g.dx) < SWIPE_MIN_PX) return null
  if (Math.abs(g.dx) < Math.abs(g.dy) * SWIPE_AXIS_RATIO) return null
  return g.dx < 0 ? 'next' : 'prev'
}

/** Has the gesture committed to horizontal yet? Used to show the peek and stop it fighting a scroll. */
export function lockAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return null
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
}

/** A minimal element shape, so the start guard can be tested without a DOM. */
export type SwipeTargetNode = {
  tagName?: string
  isContentEditable?: boolean
  getAttribute?: (name: string) => string | null
  scrollWidth?: number
  clientWidth?: number
  overflowX?: string
  parentElement?: SwipeTargetNode | null
}

const FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'VIDEO', 'IFRAME'])

/**
 * Should a touch starting here be left alone? Yes when it starts in a platform edge gesture zone, in
 * a form control, inside anything that opts out (`data-no-league-swipe`), or inside an element that
 * scrolls sideways itself — a chip row, a table, a carousel. Those own the horizontal gesture.
 */
export function swipeStartBlocked(node: SwipeTargetNode | null, x: number, viewportWidth: number): boolean {
  if (x < EDGE_GUARD_PX || x > viewportWidth - EDGE_GUARD_PX) return true
  for (let n: SwipeTargetNode | null | undefined = node; n; n = n.parentElement) {
    if (n.tagName && FORM_TAGS.has(n.tagName.toUpperCase())) return true
    if (n.isContentEditable) return true
    if (n.getAttribute?.('data-no-league-swipe') != null) return true
    const scrollsX =
      (n.overflowX === 'auto' || n.overflowX === 'scroll') &&
      (n.scrollWidth ?? 0) > (n.clientWidth ?? 0) + 1
    if (scrollsX) return true
  }
  return false
}
