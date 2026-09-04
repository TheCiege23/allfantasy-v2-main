/**
 * Commissioner OS breakpoints — the authoritative, JS-consumable source.
 *
 * CSS custom properties cannot be read inside @media conditions, so these
 * numbers (not app/globals.css's --breakpoint-* reference properties) are
 * the source of truth for any breakpoint logic in JS — matchMedia calls, a
 * future useBreakpoint hook, etc. Matches Design Language & Experience
 * System §2 and the existing 640px mobile threshold already used
 * elsewhere in app/globals.css.
 */
export const breakpoints = {
  tablet: 640,
  desktop: 1024,
  largeDesktop: 1440,
} as const

export type Breakpoint = keyof typeof breakpoints

/**
 * mediaQuery('tablet') -> "(min-width: 640px)"
 * mediaQuery('tablet', 'down') -> "(max-width: 639px)"
 */
export function mediaQuery(breakpoint: Breakpoint, direction: 'up' | 'down' = 'up'): string {
  const px = breakpoints[breakpoint]
  return direction === 'up' ? `(min-width: ${px}px)` : `(max-width: ${px - 1}px)`
}
