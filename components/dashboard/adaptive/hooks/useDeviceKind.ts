'use client'

import { useEffect, useState } from 'react'

/**
 * Effective layout device for the adaptive dashboard.
 *
 * The dashboard renders three genuinely different component trees (sidebar / icon rail /
 * bottom tab bar), not one tree reflowed by CSS — so the breakpoint has to be readable in
 * JS, not only in a media query.
 */
export type DeviceKind = 'mobile' | 'tablet' | 'desktop'
export type DeviceOverride = 'auto' | DeviceKind

/**
 * Breakpoints from the design handoff: mobile <768, tablet 768–1279, desktop ≥1280.
 *
 * ⚠ Three breakpoint scales exist in this repo and they do NOT agree — stating the choice
 * explicitly so the next reader doesn't "fix" it toward the wrong one:
 *   - Tailwind (stock):                   640 / 768 / 1024 / 1280 / 1536
 *   - lib/commissioner-os/tokens/…:       640 / 1024 / 1440
 *   - this dashboard (design contract):   768 / 1280
 *
 * The handoff pins its three layouts to 768/1280 and the sidebar→rail→tab-bar transitions
 * are drawn at those widths, so those win here. They also line up with Tailwind's `md` and
 * `xl`, which keeps any CSS-side helpers consistent; the commissioner-os scale is scoped to
 * that product area and is deliberately not imported.
 */
export const MOBILE_MAX = 767
export const TABLET_MAX = 1279

export function deviceFromWidth(width: number): DeviceKind {
  if (width <= MOBILE_MAX) return 'mobile'
  if (width <= TABLET_MAX) return 'tablet'
  return 'desktop'
}

/**
 * Live device kind, recomputed on resize.
 *
 * `override` force-selects a device for preview regardless of viewport (the design-review
 * affordance); 'auto' follows the real viewport. The hook is mounted inside an `ssr:false`
 * subtree, so `window` is available on first render and the initial value is already
 * correct — no desktop-then-mobile flash on a phone. The `typeof window` guard only exists
 * so the module stays importable from a server component.
 */
export function useDeviceKind(override: DeviceOverride = 'auto'): DeviceKind {
  const [measured, setMeasured] = useState<DeviceKind>(() =>
    typeof window === 'undefined' ? 'desktop' : deviceFromWidth(window.innerWidth),
  )

  useEffect(() => {
    // matchMedia over a resize listener: it fires only when the bucket actually changes,
    // so dragging a window across 900px doesn't re-render the tree on every pixel.
    const mobile = window.matchMedia(`(max-width: ${MOBILE_MAX}px)`)
    const tablet = window.matchMedia(`(min-width: ${MOBILE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`)
    const sync = () => setMeasured(deviceFromWidth(window.innerWidth))
    sync()
    mobile.addEventListener('change', sync)
    tablet.addEventListener('change', sync)
    return () => {
      mobile.removeEventListener('change', sync)
      tablet.removeEventListener('change', sync)
    }
  }, [])

  return override === 'auto' ? measured : override
}
