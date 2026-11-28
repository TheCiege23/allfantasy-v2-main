/**
 * Remove redundant and diagnostic-only fields from every draft pool entry. Nothing in the draft room
 * reads them (moved out of app/api/leagues/[leagueId]/draft/pool/route.ts, 2026-11-28):
 *
 *   display.assets: headshotFallbackUrl + teamLogoFallbackUrl (+ their *Used flags) — the SAME encoded
 *     SVG on every player, ~1.1 KB per entry. `headshotUrl` is always set (a real photo, or the
 *     resolver's own placeholder), so every `?? headshotFallbackUrl` reader is unreachable for a pool row.
 *   display.stats: rollingInsightsSupplemental (diagnostic) and projectionSource (duplicated at top level).
 *   display.metadata: rookieYearsExpSource — provenance enum, never displayed or filtered on.
 *
 * 🛑 BOTH WRITERS OF draft_pool_cache MUST STRIP, NOT ONLY THE ROUTE. The route stripped on every read and
 * on its own write, but `ensureDraftPoolReady` saved the full entries: measured on production 2026-11-28,
 * its 2,392-player NCAAB row was 6.9 MB against 3.7 MB on the wire — 2.6 MB read from Postgres on every
 * pool request only to be thrown away.
 */
export function stripPoolEntriesFallbacks<T>(entries: T[]): T[] {
  return entries.map((entry) => {
    const e = entry as Record<string, unknown>
    if (!e || typeof e !== 'object' || !e.display || typeof e.display !== 'object') return entry
    let display = e.display as Record<string, unknown>

    if (display.assets && typeof display.assets === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { headshotFallbackUrl: _hf, teamLogoFallbackUrl: _tf, headshotFallbackUsed: _hu, teamLogoFallbackUsed: _tu, ...assets } = display.assets as Record<string, unknown>
      display = { ...display, assets }
    }
    if (display.stats && typeof display.stats === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { rollingInsightsSupplemental: _ris, projectionSource: _ps, ...stats } = display.stats as Record<string, unknown>
      display = { ...display, stats }
    }
    if (display.metadata && typeof display.metadata === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { rookieYearsExpSource: _rys, ...metadata } = display.metadata as Record<string, unknown>
      display = { ...display, metadata }
    }
    return { ...e, display } as T
  })
}

/** The same strip over a whole pool response body. */
export function stripPoolEntryFallbacks<P extends { entries?: unknown[] }>(payload: P): P {
  if (!Array.isArray(payload.entries) || payload.entries.length === 0) return payload
  return { ...payload, entries: stripPoolEntriesFallbacks(payload.entries) }
}
