import type { CSSProperties } from 'react'

/**
 * /admin-login always paints a LIGHT surface (white card on a white-to-#EEF1F7 page), but its
 * text reads the app's theme tokens. Those tokens follow `html[data-mode]`, and dark mode sets
 * `--text` / `--muted` to near-white — so in dark mode the heading, instructions, field label
 * and footer rendered white on white. Measured on production 2026-11-13: h1 computed
 * `rgba(255, 255, 255, 0.92)` on a `rgb(255, 255, 255)` background.
 *
 * Re-declaring the light values on the page root pins them for every descendant regardless of
 * the site theme. The values are app/globals.css's own `:root` (light) tokens, not new colors.
 * `colorScheme: 'light'` keeps native controls (input text, caret, autofill) light as well.
 *
 * Kept in its own module so both the client page and the server-rendered Suspense fallback in
 * page.tsx can apply it.
 */
export const ADMIN_LOGIN_LIGHT_TOKENS = {
  '--text': 'rgba(2,6,23,0.92)',
  '--muted': 'rgba(2,6,23,0.65)',
  '--muted2': 'rgba(2,6,23,0.45)',
  '--border': 'rgba(2,6,23,0.10)',
  '--accent': '#2563EB',
  colorScheme: 'light',
} as CSSProperties
