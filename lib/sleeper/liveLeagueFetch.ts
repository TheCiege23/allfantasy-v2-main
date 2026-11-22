/**
 * The Sleeper calls behind the live roster panel — the vendor boundary, and nothing else (security
 * cleanup, 2026-11-15). Its ONLY runtime importer is `./liveLeagueFeed.ts`, the short shared cache the
 * route reads; the exemption in scripts/check-db-first-api-boundary.mjs is granted on that census.
 *
 * Sleeper's API is public (no credential), so the risk this removes is not a leaked secret: it is an
 * UNCACHED vendor call per viewer per poll. LiveRosterPanel polls every 20s, so a 12-team league
 * mid-draft with everyone watching made dozens of identical Sleeper calls a minute. Returns `null` for
 * "no answer" (non-ok, network error, timeout), never throws.
 */

const SLEEPER = 'https://api.sleeper.app/v1'
const TIMEOUT_MS = 6000

export async function fetchSleeperJson<T>(path: string): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${SLEEPER}${path}`, { cache: 'no-store', signal: controller.signal })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
