/**
 * Pull to refresh on a phone (founder, 2026-10-08) — the rules, pure and client-safe.
 *
 * At the top of a /core screen, pull down and let go to reload it. An installed AllFantasy app on
 * iOS has no browser refresh at all, and Android's only reloads the whole page — this reloads the
 * screen's data in place and, when the leagues themselves are stale, starts the same sync "Sync now"
 * runs. PullToRefresh.tsx owns the listeners; everything that decides lives here.
 */

/** The indicator moves half as far as the finger: rubber-band resistance, like every native list. */
export const PULL_RESISTANCE = 0.5
/** How far the INDICATOR must travel (finger: twice this) before letting go refreshes. */
export const PULL_THRESHOLD_PX = 64
/** The indicator never travels further than this, however far the finger goes. */
export const PULL_MAX_PX = 96

export function pullDistance(fingerDy: number): number {
  if (fingerDy <= 0) return 0
  return Math.min(PULL_MAX_PX, fingerDy * PULL_RESISTANCE)
}

export function pullIsReady(distance: number): boolean {
  return distance >= PULL_THRESHOLD_PX
}

/** Vertical and downward, decided once the finger has moved a little — a sideways swipe is not a pull. */
export function pullAxis(dx: number, dy: number): 'pull' | 'other' | null {
  if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return null
  return dy > 0 && dy > Math.abs(dx) * 1.2 ? 'pull' : 'other'
}

/** A minimal element shape, so the start guard can be tested without a DOM. */
export type PullTargetNode = {
  tagName?: string
  isContentEditable?: boolean
  getAttribute?: (name: string) => string | null
  scrollTop?: number
  scrollHeight?: number
  clientHeight?: number
  overflowY?: string
  parentElement?: PullTargetNode | null
}

const FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'IFRAME'])

/**
 * Should a touch starting here be left alone? Yes when the page is not at its top, in a form control,
 * inside a dialog or anything that opts out (`data-no-pull-refresh`), or inside an element that
 * scrolls vertically itself — the chat thread, a drawer, a long list. Those own the downward drag.
 */
export function pullStartBlocked(node: PullTargetNode | null, pageScrollTop: number): boolean {
  if (pageScrollTop > 0) return true
  for (let n: PullTargetNode | null | undefined = node; n; n = n.parentElement) {
    if (n.tagName && FORM_TAGS.has(n.tagName.toUpperCase())) return true
    if (n.isContentEditable) return true
    if (n.getAttribute?.('data-no-pull-refresh') != null) return true
    if (n.getAttribute?.('role') === 'dialog' || n.getAttribute?.('aria-modal') === 'true') return true
    const scrollsY =
      (n.overflowY === 'auto' || n.overflowY === 'scroll') && (n.scrollHeight ?? 0) > (n.clientHeight ?? 0) + 1
    if (scrollsY) return true
  }
  return false
}
