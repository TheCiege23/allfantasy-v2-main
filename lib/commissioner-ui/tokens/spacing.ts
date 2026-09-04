/**
 * Commissioner OS spacing, radius, sizing, elevation, motion, and z-index
 * tokens — base-4 spacing scale per Design Language & Experience System §21.
 *
 * CSS (app/globals.css) is the source of truth for every value. The px/rem
 * figures mirrored below exist only for JS logic that genuinely needs a
 * number (layout math, non-CSS libraries) — never as license to hardcode a
 * value that could instead reference the CSS variable directly.
 */

export const spacingScale = {
  4: { token: '--space-4', px: 4 },
  8: { token: '--space-8', px: 8 },
  12: { token: '--space-12', px: 12 },
  16: { token: '--space-16', px: 16 },
  24: { token: '--space-24', px: 24 },
  32: { token: '--space-32', px: 32 },
  48: { token: '--space-48', px: 48 },
  64: { token: '--space-64', px: 64 },
  96: { token: '--space-96', px: 96 },
} as const

export type SpacingStep = keyof typeof spacingScale

export const radiusScale = {
  subtle: { token: '--radius-subtle', px: 8 },
  standard: { token: '--radius-standard', px: 12 },
  generous: { token: '--radius-generous', px: 16 },
} as const

export type RadiusStep = keyof typeof radiusScale

/** Two levels only, per Design Language §21. */
export const elevationScale = {
  0: '--elevation-0',
  1: '--elevation-1',
} as const

export type ElevationStep = keyof typeof elevationScale

/** Named aliases onto the existing --transition-premium/--transition-slow tokens. */
export const motionScale = {
  micro: { token: '--motion-micro', ms: 200 },
  panel: { token: '--motion-panel', ms: 300 },
} as const

export type MotionStep = keyof typeof motionScale

export const iconSizeScale = {
  compact: { token: '--icon-size-compact', px: 16 },
  standard: { token: '--icon-size-standard', px: 20 },
  large: { token: '--icon-size-large', px: 24 },
} as const

export const controlHeightScale = {
  compact: { token: '--control-height-compact', px: 32 },
  standard: { token: '--control-height-standard', px: 40 },
  large: { token: '--control-height-large', px: 48 },
} as const

export const badgeHeightScale = {
  compact: { token: '--badge-height-compact', px: 18 },
  standard: { token: '--badge-height-standard', px: 22 },
} as const

export const containerWidthScale = {
  reading: { token: '--container-width-reading', px: 720 },
  dashboard: { token: '--container-width-dashboard', px: 1440 },
} as const

/** Layered below the two pre-existing hardcoded z-index values in
 * app/globals.css (radix popper: 90, crest overlay: 120) by design. */
export const zIndexScale = {
  base: { token: '--z-base', value: 1 },
  sticky: { token: '--z-sticky', value: 10 },
  dropdown: { token: '--z-dropdown', value: 20 },
  drawer: { token: '--z-drawer', value: 30 },
  modal: { token: '--z-modal', value: 40 },
  commandPalette: { token: '--z-command-palette', value: 50 },
  toast: { token: '--z-toast', value: 60 },
} as const

export const opacityScale = {
  disabled: { token: '--opacity-disabled', value: 0.5 },
  hover: { token: '--opacity-hover', value: 0.9 },
  overlay: { token: '--opacity-overlay', value: 0.6 },
} as const
