import type { LegacyImportStatusResponse } from "./types"

/**
 * Fetches legacy import status for the current user (Sleeper link + job status; others placeholder).
 */
export async function getLegacyImportStatus(): Promise<LegacyImportStatusResponse> {
  const res = await fetch("/api/user/legacy-import-status", { cache: "no-store" })
  /*
   * ⚠ THROW, DO NOT RETURN AN EMPTY RESULT. An empty `providers` renders as "every platform coming
   * soon" plus the empty state — so a 401 or a 500 looked like a user who simply had nothing, and the
   * Settings section's "couldn't load" message (its catch) could never appear.
   */
  if (!res.ok) throw new Error(`legacy-import-status ${res.status}`)
  const data = await res.json().catch(() => ({}))
  return {
    sleeperUsername: data.sleeperUsername ?? null,
    providers: data.providers ?? {},
  }
}

/**
 * Explicit refresh helper for settings UI actions.
 */
export async function refreshLegacyImportStatus(): Promise<LegacyImportStatusResponse> {
  return getLegacyImportStatus()
}
