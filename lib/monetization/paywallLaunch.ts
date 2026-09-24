/**
 * When the paywall starts. ONE constant, read by every gate that switches on at launch.
 *
 * Owner's decision (2026-09-24): the paywall starts October 15, 2026. Midnight US Eastern
 * that day is 04:00 UTC (EDT is UTC-4 until November 1). A gate that is keyed to this
 * flips on its own — nobody deploys on launch day, and every gate flips at the same
 * instant instead of whenever each one happened to ship.
 *
 * `AF_PAYWALL_STARTS_AT` (an ISO timestamp) moves it without a code change, e.g. to
 * postpone. An unparseable value is IGNORED rather than treated as "now": a typo in an
 * env var must never switch the paywall on early.
 */

export const DEFAULT_PAYWALL_STARTS_AT = new Date('2026-10-15T04:00:00.000Z')

export function getPaywallStartsAt(env: Record<string, string | undefined> = process.env): Date {
  const raw = env.AF_PAYWALL_STARTS_AT?.trim()
  if (raw) {
    const parsed = new Date(raw)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return DEFAULT_PAYWALL_STARTS_AT
}

export function isPaywallLive(
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): boolean {
  return now.getTime() >= getPaywallStartsAt(env).getTime()
}
