import { DRAFT_PHONE_LANDSCAPE_QUERY } from './phoneDraftLayout'

/**
 * Which draft-room surface shows Chimmy at a given viewport.
 *
 * The room renders BOTH layouts at every width and hides one with CSS (`DraftRoomShell`:
 * `hidden md:flex` desktop, the phone tray below md; the right dock is `hidden xl:flex`, the bottom
 * dock `xl:hidden`). So opening every Chimmy surface at once mounts three helper panels and three
 * chats, two of them invisible. Measured in the mobile draft-room E2E: three rounds of the panel's
 * entitlement fetches, and the commissioner control center never finished loading. Open one.
 *
 * Breakpoints are Tailwind's defaults, the ones those classes use: md 768px, xl 1280px.
 */
export type ChimmySurface = 'mobile_tray' | 'bottom_dock' | 'right_dock'

export const MD_MIN_WIDTH_PX = 768
export const XL_MIN_WIDTH_PX = 1280

export function chimmySurfaceForWidth(width: number): ChimmySurface {
  if (width >= XL_MIN_WIDTH_PX) return 'right_dock'
  if (width >= MD_MIN_WIDTH_PX) return 'bottom_dock'
  return 'mobile_tray'
}

/** The surface for the current window, measured the way the CSS breakpoints are (media queries). */
export function currentChimmySurface(): ChimmySurface {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'mobile_tray'
  if (window.matchMedia(DRAFT_PHONE_LANDSCAPE_QUERY).matches) return 'mobile_tray'
  if (window.matchMedia(`(min-width: ${XL_MIN_WIDTH_PX}px)`).matches) return 'right_dock'
  if (window.matchMedia(`(min-width: ${MD_MIN_WIDTH_PX}px)`).matches) return 'bottom_dock'
  return 'mobile_tray'
}
