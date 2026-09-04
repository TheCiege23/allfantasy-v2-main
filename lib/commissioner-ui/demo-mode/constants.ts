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

/** Demo is the default — the mode every non-developer audience (sales, QA, training) should see without configuration. */
export const DEFAULT_DATA_MODE: CommissionerDataMode = 'demo'

export const DATA_MODE_LABELS: Record<CommissionerDataMode, string> = {
  stub: 'Stub (developer fixtures)',
  demo: 'Demo (curated data)',
  live: 'Live (real intelligence)',
}

export function isValidDataMode(value: string | null | undefined): value is CommissionerDataMode {
  return value === 'stub' || value === 'demo' || value === 'live'
}

export function normalizeDataMode(value: string | null | undefined): CommissionerDataMode {
  return isValidDataMode(value) ? value : DEFAULT_DATA_MODE
}
