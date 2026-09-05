'use client'

/**
 * One `/api/league/trades-panel` read per league, however many components ask for it.
 *
 * 🛑 THE TRADE SCREEN ASKED FOR THE SAME LEAGUE TWICE ON EVERY LOAD. `TradeInbox` fetches the
 * current league's panel, and `TradeLeagueStrip` fetches a tile per league WITHOUT excluding the
 * one already on screen. Measured in the dev server log, on a single page load:
 *
 *     GET /api/league/trades-panel?leagueId=2d2cc403…  200 in 16802ms
 *     GET /api/league/trades-panel?leagueId=2d2cc403…  200 in 17247ms   <- same league, again
 *     …the other eight leagues appear exactly once each
 *
 * That second read is not cheap. This route runs `scanPendingSleeperTrades`, so on a cache miss
 * it costs a full sweep of the provider's transactions for that league.
 *
 * ⚠ THE FIX IS DEDUPLICATION, NOT CACHING. Two components mounting together share ONE in-flight
 * request; anything asking later than the window gets a fresh read. A real cache would have to
 * answer "how stale may an offer inbox be", which is a product question nobody has asked.
 *
 * ⚠ AND IT IS NOT A FIX FOR STRICTMODE. `next.config.js` sets `reactStrictMode: true`, so dev
 * double-invokes effects and this collapses those too — but the duplicate above is REAL and
 * survives into production, because it comes from two different components, not one effect
 * running twice. Do not read the dev log's counts as the production count.
 */

export type TradesPanelResult = {
  ok: boolean
  status: number
  /** Parsed body, or `{}` when the response was not JSON. */
  data: unknown
}

/**
 * How long a completed read may be shared.
 *
 * Long enough that components mounting in the same tick share one request; short enough that an
 * explicit refresh a moment later still reaches the server. It is a coalescing window, not a TTL
 * on freshness — see the note above.
 */
const SHARE_WINDOW_MS = 5_000

const shared = new Map<string, { at: number; promise: Promise<TradesPanelResult> }>()

/**
 * ⚠ CALLERS MUST TREAT `data` AS READ-ONLY. They are handed the SAME parsed object, which is what
 * makes this cheap; mutating it would change what the other component sees.
 */
export function fetchTradesPanel(
  leagueId: string,
  opts?: { force?: boolean },
): Promise<TradesPanelResult> {
  const now = Date.now()
  const hit = shared.get(leagueId)
  if (!opts?.force && hit && now - hit.at < SHARE_WINDOW_MS) return hit.promise

  const promise = (async (): Promise<TradesPanelResult> => {
    const r = await fetch(`/api/league/trades-panel?leagueId=${encodeURIComponent(leagueId)}`)
    const data = await r.json().catch(() => ({}))
    return { ok: r.ok, status: r.status, data }
  })().catch((err) => {
    /*
     * ⚠ EVICT ON FAILURE, or one refused request would be replayed to every caller for the whole
     * window — turning a blip into a screen that cannot recover until it ages out.
     */
    shared.delete(leagueId)
    throw err
  })

  shared.set(leagueId, { at: now, promise })
  return promise
}

/** Test seam: drops the shared window so a case starts from nothing. */
export function __resetTradesPanelShare(): void {
  shared.clear()
}
