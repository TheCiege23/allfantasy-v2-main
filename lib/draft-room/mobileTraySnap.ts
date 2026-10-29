/**
 * Snap logic for the mobile draft tray — the Sleeper-style bottom sheet that holds Players / Queue /
 * Roster / Chat over an always-visible board. Pure, so the gesture maths is testable without a DOM.
 *
 * Three resting heights for the tray's CONTENT area (the handle and tab bar sit outside it):
 *
 *   peek  0              only the tab bar shows; the whole board is visible
 *   half  ~55% of full   board and tray share the screen
 *   full  everything     the tray covers the board below the top bar
 *
 * A release snaps to the nearest height, unless the finger was moving fast: a flick goes to the next
 * height in its direction even from close to the current one, which is what makes a sheet feel
 * like it follows the hand instead of rubber-banding back.
 */

export type TraySnap = 'peek' | 'half' | 'full'

const ORDER: readonly TraySnap[] = ['peek', 'half', 'full']

/** Share of the full height used by the half snap. */
export const HALF_RATIO = 0.55

/** px/ms. Above this a release counts as a flick. ~0.5 is the common platform figure. */
export const FLICK_VELOCITY = 0.5

/** Content-area height in px for a snap, given the height `full` would have. */
export function trayHeightFor(snap: TraySnap, fullHeight: number): number {
  const full = Math.max(0, Number.isFinite(fullHeight) ? fullHeight : 0)
  if (snap === 'peek') return 0
  if (snap === 'half') return Math.round(full * HALF_RATIO)
  return Math.round(full)
}

/**
 * Where a drag should settle.
 *
 * `velocity` is px/ms in SCREEN terms: positive means the finger was moving DOWN (the tray
 * shrinking), negative UP. That is the sign a pointer's clientY delta naturally has.
 */
export function resolveTraySnap(input: { heightPx: number; velocity: number; fullHeight: number }): TraySnap {
  const heights = ORDER.map((snap) => ({ snap, h: trayHeightFor(snap, input.fullHeight) }))
  const h = Math.max(0, input.heightPx)
  const v = Number.isFinite(input.velocity) ? input.velocity : 0

  if (v > FLICK_VELOCITY) {
    const below = heights.filter((s) => s.h < h - 1)
    return below.length ? below[below.length - 1]!.snap : 'peek'
  }
  if (v < -FLICK_VELOCITY) {
    const above = heights.filter((s) => s.h > h + 1)
    return above.length ? above[0]!.snap : 'full'
  }

  let best = heights[0]!
  for (const s of heights) {
    if (Math.abs(s.h - h) < Math.abs(best.h - h)) best = s
  }
  return best.snap
}

/** One step up or down, for keyboard control of the handle. Clamped at the ends. */
export function stepTraySnap(snap: TraySnap, direction: 'up' | 'down'): TraySnap {
  const i = ORDER.indexOf(snap)
  const next = direction === 'up' ? Math.min(ORDER.length - 1, i + 1) : Math.max(0, i - 1)
  return ORDER[next]!
}

/** Enter/Space on the handle: peek → half → full → peek. */
export function cycleTraySnap(snap: TraySnap): TraySnap {
  return ORDER[(ORDER.indexOf(snap) + 1) % ORDER.length]!
}
