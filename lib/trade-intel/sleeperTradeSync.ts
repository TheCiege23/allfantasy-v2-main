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
export async function currentCompletedTradeIds(sleeperLeagueId: string): Promise<string[] | null> {
  const weeks = await Promise.all(
    Array.from({ length: MAX_WEEKS }, (_, i) =>
      j<{ transaction_id: string; type: string; status: string }[]>(
        `/league/${sleeperLeagueId}/transactions/${i + 1}`,
      ),
    ),
  )
  if (weeks.every((w) => w == null)) return null
  const ids: string[] = []
  for (const w of weeks) {
    for (const t of w ?? []) {
      if (t.type === 'trade' && t.status === 'complete') ids.push(t.transaction_id)
    }
  }
  return ids
}

/** Current rosters, for roster-need analysis. Null when unavailable. */
export async function fetchLeagueRosters(sleeperLeagueId: string): Promise<SleeperRoster[] | null> {
  return j<SleeperRoster[]>(`/league/${sleeperLeagueId}/rosters`)
}
