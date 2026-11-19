'use client'

/**
 * "Is Yahoo copy-paste open for this account?" — one answer for the import screen and the panel.
 *
 * Rollout lives on the server (`isYahooSnapshotImportOpenFor`, lib/yahoo/yahooAvailability.ts), which
 * a client component cannot read. Asked once per page load and shared, so the Yahoo tile, its guide
 * and the panel all agree and the endpoint is hit once, not three times.
 *
 * ⚠ A FAILED CHECK READS AS "NOT OPEN" AND IS NOT CACHED. "Not open" is the safe answer — the screen
 * falls back to the ordinary coming-soon state — and forgetting the failure lets the next mount retry.
 */
import { useEffect, useState } from 'react'

const ENDPOINT = '/api/leagues/import/yahoo-snapshot'

let pending: Promise<boolean> | null = null

export function fetchYahooCopyPasteEnabled(): Promise<boolean> {
  if (!pending) {
    pending = fetch(ENDPOINT, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => body?.enabled === true)
      .catch(() => false)
      .then((enabled) => {
        if (!enabled) pending = null
        return enabled
      })
  }
  return pending
}

export function useYahooCopyPasteEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let alive = true
    void fetchYahooCopyPasteEnabled().then((v) => {
      if (alive) setEnabled(v)
    })
    return () => {
      alive = false
    }
  }, [])
  return enabled
}

/** Fired by the Yahoo tile's "Import by copy-paste" button; the panel opens and scrolls into view. */
export const OPEN_YAHOO_COPY_PASTE_EVENT = 'af:open-yahoo-copy-paste'

export function openYahooCopyPaste(): void {
  window.dispatchEvent(new Event(OPEN_YAHOO_COPY_PASTE_EVENT))
}
