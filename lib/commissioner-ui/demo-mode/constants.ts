/**
 * Commissioner OS's three data modes — Stub (developer fixtures), Demo
 * (realistic curated data for sales/screenshots/QA/training), and Live
 * (the real Decision OS, once it exists). Every module's Decision OS
 * client resolves to the matching implementation without the module
 * itself knowing which one it's talking to.
 *
 * Follows the exact cookie-based pattern already established for theme
 * (lib/theme) — a cookie readable both server-side (Server Components)
 * and client-side (the mode indicator), not a new mechanism.
 */
export type CommissionerDataMode = 'stub' | 'demo' | 'live'

export const DATA_MODE_COOKIE_KEY = 'commissioner_os_data_mode'

/**
 * Live is the default — a commissioner opening this product sees their own league.
 *
 * 🛑 THIS WAS `'demo'`, AND IT MEANT NO PRODUCTION USER COULD EVER REACH REAL DATA.
 * The mode is resolved from a cookie, and the only code that writes that cookie
 * (`DataModeIndicator`) returned `null` in production. So the fallback below was not a
 * default in any meaningful sense — it was the ONLY value production ever resolved, for
 * every user, on every request. Every other gate behind it (11 `isLiveReady` flags,
 * `DECISION_OS_BASE_URL`, the API key, `DECISION_OS_INTELLIGENCE_API_ENABLED`,
 * `..._API_PROVIDER=real`) was already open and verified working; this one line was the
 * whole reason Commissioner OS showed curated fixtures to paying commissioners.
 *
 * Demo remains fully reachable — it is what sales, screenshots, QA and training want, and
 * it is now an explicit choice rather than everyone's silent fate. See `DataModeIndicator`
 * for who may make that choice.
 */
export const DEFAULT_DATA_MODE: CommissionerDataMode = 'live'

export const DATA_MODE_LABELS: Record<CommissionerDataMode, string> = {
  stub: 'Stub (developer fixtures)',
  demo: 'Demo (curated data)',
  live: 'Live (real intelligence)',
}

export function isValidDataMode(value: string | null | undefined): value is CommissionerDataMode {
  return value === 'stub' || value === 'demo' || value === 'live'
}

/**
 * Stub is invented developer fixtures that look exactly like real data. The mode lives in a
 * cookie, which the viewer can edit, so THIS is the enforcement point — not the UI that
 * offers the choice. Without it, pasting `commissioner_os_data_mode=stub` into devtools puts
 * a paying commissioner on fabricated managers and scores with no indication anything is
 * wrong. `NODE_ENV` is inlined by Next into the client bundle too, so the same rule holds on
 * both sides of the wire.
 */
export function isSelectableDataMode(
  mode: CommissionerDataMode,
  isProduction: boolean = process.env.NODE_ENV === 'production',
): boolean {
  return mode === 'stub' ? !isProduction : true
}

export function normalizeDataMode(value: string | null | undefined): CommissionerDataMode {
  if (!isValidDataMode(value)) return DEFAULT_DATA_MODE
  return isSelectableDataMode(value) ? value : DEFAULT_DATA_MODE
}
