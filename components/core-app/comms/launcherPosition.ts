/**
 * Where the chat bubble sits after somebody drags it — pure, so the snapping and
 * clamping can be proven without a pointer.
 *
 * Owner's ask (2026-09-25): "can we make it so the chat bubble can be moved
 * around the screen on mobile, tablet and pc?"
 *
 * ⚠ THE DEFAULT GEOMETRY STAYS THE STYLESHEET'S. Until somebody drags it, the
 * bubble sits exactly where `--af-fab-inset` / `--af-fab-bottom` put it — the
 * tokens that keep it off the phone tab bar's "More" item, a bug that has shipped
 * twice (af-comms.css records both). A stored position only ever REPLACES those
 * tokens once the user has chosen one, and even then it is clamped so the bubble
 * can never be dropped lower than the token's own bottom: dragging cannot put it
 * back on the tab bar.
 *
 * ⚠ IT SNAPS TO AN EDGE. A bubble left floating mid-screen covers whatever the
 * page drew there; one hugging the left or right edge covers a strip everybody
 * already expects to be busy.
 */

export type LauncherSide = 'left' | 'right'

/** `bottom` is the gap, in CSS px, between the viewport's bottom and the bubble's bottom edge. */
export type LauncherPosition = { side: LauncherSide; bottom: number }

export type LauncherBounds = {
  viewportWidth: number
  viewportHeight: number
  /** The bubble's diameter. */
  size: number
  /** The stylesheet's own bottom offset — the lowest the bubble may sit (clears the tab bar). */
  minBottom: number
  /** Space kept free at the top (status bar, notch, app header). */
  topReserve: number
}

/** Movement below this is a tap, not a drag. Touch slop on phones is ~8–10px. */
export const DRAG_THRESHOLD_PX = 8

export function exceedsDragThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX
}

export type LauncherDevice = 'phone' | 'tablet' | 'desktop'

/**
 * A position is remembered PER DEVICE CLASS, not once: a spot that suits a
 * 1440px monitor is meaningless on a 390px phone, and a tablet turned sideways
 * crosses from one class to the other.
 */
export function launcherDevice(viewportWidth: number): LauncherDevice {
  if (viewportWidth < 720) return 'phone'
  if (viewportWidth < 1200) return 'tablet'
  return 'desktop'
}

export function launcherStorageKey(device: LauncherDevice): string {
  return `af:comms-launcher:v1:${device}`
}

export function clampLauncher(p: LauncherPosition, b: LauncherBounds): LauncherPosition {
  const maxBottom = Math.max(b.minBottom, b.viewportHeight - b.size - b.topReserve)
  const bottom = Number.isFinite(p.bottom) ? p.bottom : b.minBottom
  return { side: p.side, bottom: Math.round(Math.min(maxBottom, Math.max(b.minBottom, bottom))) }
}

/**
 * Where a bubble released with its centre at (x, y) settles: the nearer side,
 * at the height it was dropped, clamped into the safe band.
 */
export function snapLauncher(center: { x: number; y: number }, b: LauncherBounds): LauncherPosition {
  const side: LauncherSide = center.x < b.viewportWidth / 2 ? 'left' : 'right'
  const bottom = b.viewportHeight - (center.y + b.size / 2)
  return clampLauncher({ side, bottom }, b)
}

/** Stored JSON → a position, or null for anything malformed. Never throws. */
export function parseStoredLauncher(raw: string | null | undefined): LauncherPosition | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== 'object') return null
    const o = v as Record<string, unknown>
    if (o.side !== 'left' && o.side !== 'right') return null
    if (typeof o.bottom !== 'number' || !Number.isFinite(o.bottom)) return null
    return { side: o.side, bottom: o.bottom }
  } catch {
    return null
  }
}
