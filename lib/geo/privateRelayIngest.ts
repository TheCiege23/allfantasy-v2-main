/**
 * The WRITER for the Private Relay ranges: fetch Apple's feed, parse the US rows,
 * store them. Run from the hourly reaper (`/api/cron/reap-sync-runs`), which
 * calls this every hour and lets it act at most once a day.
 *
 * ⚠ WHY IT RIDES THE REAPER RATHER THAN ITS OWN CRON. cron-schedule.json is at
 * the 60-job ceiling that scripts/cron-budget-check.mjs enforces, and that
 * guard's rule is to fold new work into an existing route. The reaper is the
 * hourly housekeeping job and already hosts the SportsDataCache purge.
 *
 * ⚠ A FAILED REFRESH NEVER OVERWRITES A GOOD SET. A fetch that fails, or a feed
 * that parses to implausibly few US ranges (a truncated download, an HTML error
 * page served with 200), leaves the stored set untouched; the store's 30-day
 * expiry is what finally retires data that stops being refreshed.
 */

import { fetchPrivateRelayEgressCsv } from "./privateRelayFetch"
import { parseEgressGeofeed } from "./privateRelayRanges"
import { readStoredRelayRanges, writeStoredRelayRanges } from "./privateRelayStore"

/** Refresh once the stored set is this old. Hourly calls make this "about daily". */
export const PRIVATE_RELAY_REFRESH_AFTER_MS = 20 * 60 * 60 * 1000

/**
 * Apple's US egress space is tens of thousands of prefixes; after merging it is
 * still thousands of ranges. Anything below this is a broken download.
 */
export const PRIVATE_RELAY_MIN_US_RANGES = 500

const FETCH_TIMEOUT_MS = 15_000

export type PrivateRelayRefreshResult =
  | { status: "fresh"; fetchedAt: string }
  | { status: "refreshed"; fetchedAt: string; ranges: number; states: number; usLines: number; invalid: number }
  | { status: "failed"; error: string; keptFetchedAt: string | null }

export async function refreshPrivateRelayRanges(
  opts: { force?: boolean; now?: Date } = {},
): Promise<PrivateRelayRefreshResult> {
  const now = opts.now ?? new Date()
  const stored = await readStoredRelayRanges(now)
  if (!opts.force && stored && now.getTime() - Date.parse(stored.fetchedAt) < PRIVATE_RELAY_REFRESH_AFTER_MS) {
    return { status: "fresh", fetchedAt: stored.fetchedAt }
  }
  const keptFetchedAt = stored?.fetchedAt ?? null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let csv: string | null
  try {
    csv = await fetchPrivateRelayEgressCsv(controller.signal)
  } finally {
    clearTimeout(timer)
  }
  if (!csv) return { status: "failed", error: "Apple egress feed could not be fetched", keptFetchedAt }

  const { set, stats } = parseEgressGeofeed(csv, now)
  const ranges = set.v4.length + set.v6.length
  if (ranges < PRIVATE_RELAY_MIN_US_RANGES) {
    return {
      status: "failed",
      error: `feed parsed to ${ranges} US ranges (${stats.lines} lines) — below ${PRIVATE_RELAY_MIN_US_RANGES}, not stored`,
      keptFetchedAt,
    }
  }

  try {
    await writeStoredRelayRanges(set)
  } catch (err) {
    return { status: "failed", error: `store write failed: ${String((err as Error)?.message ?? err)}`, keptFetchedAt }
  }
  return {
    status: "refreshed",
    fetchedAt: set.fetchedAt,
    ranges,
    states: set.states.length,
    usLines: stats.usLines,
    invalid: stats.invalid,
  }
}
