import 'server-only'

/**
 * sleeperTradeSync — every direct read of the Sleeper league API used by the
 * trade-notify path, in one place.
 *
 * The DB-first boundary guard (scripts/check-db-first-api-boundary.mjs) requires
 * direct calls to monitored data APIs to live in an ingestion/sync module rather
 * than being scattered through feature code, and that is the right shape: the
 * notify service and the expectation loader are consumers of league data, not
 * owners of how it is fetched. They now import from here and never name a host.
 *
 * Both reads are genuinely live-only. The completed-trade feed is the detection
 * signal itself — reading it from a cache would mean detecting trades as of the
 * last sync rather than as of now — and rosters are read to answer "can this
 * side still fill its starting slots today".
 *
 * Every call is failure-contained: a provider hiccup returns null so one league
 * can never break the sweep.
 */

const SLEEPER = 'https://api.sleeper.app/v1'
const MAX_WEEKS = 18

/**
 * One GET against the Sleeper league API. Null on any failure — callers in this
 * codebase always degrade rather than throw, so a provider blip narrows what a
 * feature can say instead of taking the whole sweep down.
 */
export async function sleeperGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SLEEPER}${path}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

const j = sleeperGet

export type SleeperRoster = { roster_id: number; players?: string[] | null }

/**
 * Completed trade ids in the CURRENT season's feed (cheap: 18 week fetches).
 * Null means the feed itself was unavailable — distinct from "no trades".
 */
/**
 * Trade ids in this league's transaction feed, with the status each one carries.
 *
 * 🛑 THIS USED TO BE `currentCompletedTradeIds` AND KEPT ONLY `status === 'complete'`. That is the
 * reason a manager was never told a trade had been OFFERED to them: an offer awaiting their answer
 * is `pending`, so the one notification they actually need — the one with a decision attached —
 * was the one filtered out. A completed trade is news; a pending one is a request.
 *
 * ⚠ `failed` IS STILL EXCLUDED. A withdrawn or rejected offer is not something to buzz a phone
 * about, and treating an unknown status as notifiable would turn any future Sleeper vocabulary
 * change into a spam incident. The allow-list is explicit for that reason.
 */
export type FeedTrade = { id: string; status: 'complete' | 'pending' }

const NOTIFIABLE_STATUSES = new Set(['complete', 'pending'])

export async function currentTradeIds(sleeperLeagueId: string): Promise<FeedTrade[] | null> {
  const weeks = await Promise.all(
    Array.from({ length: MAX_WEEKS }, (_, i) =>
      j<{ transaction_id: string; type: string; status: string }[]>(
        `/league/${sleeperLeagueId}/transactions/${i + 1}`,
      ),
    ),
  )
  if (weeks.every((w) => w == null)) return null
  const out: FeedTrade[] = []
  for (const w of weeks) {
    for (const t of w ?? []) {
      if (t.type !== 'trade') continue
      if (!NOTIFIABLE_STATUSES.has(t.status)) continue
      out.push({ id: t.transaction_id, status: t.status as FeedTrade['status'] })
    }
  }
  return out
}

/** Current rosters, for roster-need analysis. Null when unavailable. */
export async function fetchLeagueRosters(sleeperLeagueId: string): Promise<SleeperRoster[] | null> {
  return j<SleeperRoster[]>(`/league/${sleeperLeagueId}/rosters`)
}
