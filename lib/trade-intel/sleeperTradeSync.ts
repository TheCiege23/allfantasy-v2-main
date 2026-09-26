import 'server-only'

import type { SleeperTransaction } from '@/lib/sleeper-client'

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
    const res = await fetch(`${SLEEPER}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

const j = sleeperGet

/**
 * `owner_id` is the Sleeper USER id holding the roster. It is how a pending offer is addressed to
 * the managers actually in it — the same roster→owner join the league Trades panel makes — so an
 * offer alert and the "Needs you" list agree about who is involved.
 */
export type SleeperRoster = { roster_id: number; owner_id?: string | null; players?: string[] | null }

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
export type FeedTrade = {
  id: string
  status: 'complete' | 'pending'
  /**
   * Who is in the trade, what moves, and who proposed it. Carried because a PENDING offer is never
   * in the graded ledger — the ledger reads completed trades only — so the offer alert has to be
   * built from the feed row itself or it cannot be built at all.
   */
  rosterIds: number[]
  creator: string | null
  createdMs: number | null
  /** The week the transaction is filed under — the archive stores it (`LeagueTrade.week`). */
  week?: number
  tx: Partial<Pick<SleeperTransaction, 'adds' | 'drops' | 'draft_picks' | 'waiver_budget'>>
  /**
   * The transaction exactly as Sleeper sent it — for the offer ledger's `payload` and its fields
   * this type does not model (`consenter_ids`, `leg`). Absent on a row built anywhere but here.
   */
  raw?: Record<string, unknown>
}

const NOTIFIABLE_STATUSES = new Set(['complete', 'pending'])

type WireTrade = Partial<Pick<SleeperTransaction, 'adds' | 'drops' | 'draft_picks' | 'waiver_budget'>> & {
  transaction_id: string
  type: string
  status: string
  roster_ids?: number[] | null
  creator?: string | null
  created?: number | null
}

/**
 * The trades in a league's transaction feed — every week, or only `options.weeks`.
 *
 * ⚠ A WEEKS-LIMITED READ IS A SLICE, NOT THE FEED. It is what the 5-minute offer sweep reads
 * (`detectAndNotifyRecent`): a new offer is filed under the week it is sent in, so the current weeks
 * are where one can appear, at 3 requests a league instead of 18. It cannot see an old offer being
 * answered or a trade filed under an earlier week, so nothing may treat "absent from a slice" as
 * "gone" — and a league's first read (the seen-set bootstrap) must never come from one.
 */
export async function currentTradeIds(
  sleeperLeagueId: string,
  options?: { requireComplete?: boolean; weeks?: ReadonlyArray<number> },
): Promise<FeedTrade[] | null> {
  const weekNumbers = options?.weeks
    ? [...new Set(options.weeks)].filter((w) => Number.isInteger(w) && w >= 1 && w <= MAX_WEEKS).sort((a, b) => a - b)
    : Array.from({ length: MAX_WEEKS }, (_, i) => i + 1)
  if (weekNumbers.length === 0) return null
  const weeks = await Promise.all(
    weekNumbers.map((week) =>
      j<WireTrade[]>(
        `/league/${sleeperLeagueId}/transactions/${week}`,
      ),
    ),
  )
  if (weeks.every((w) => w == null)) return null
  if (options?.requireComplete && weeks.some((w) => w == null)) return null
  const out: FeedTrade[] = []
  for (const [index, w] of weeks.entries()) {
    for (const t of w ?? []) {
      if (t.type !== 'trade') continue
      if (!NOTIFIABLE_STATUSES.has(t.status)) continue
      out.push({ id: t.transaction_id, status: t.status as FeedTrade['status'],
        rosterIds: Array.isArray(t.roster_ids) ? t.roster_ids.map(Number).filter(Number.isFinite) : [],
        creator: typeof t.creator === 'string' && t.creator ? t.creator : null,
        createdMs: typeof t.created === 'number' ? t.created : null,
        week: weekNumbers[index],
        tx: { adds: t.adds, drops: t.drops, draft_picks: t.draft_picks, waiver_budget: t.waiver_budget },
        raw: t as unknown as Record<string, unknown>,
      })
    }
  }
  return out
}

/** Current rosters, for roster-need analysis. Null when unavailable. */
export async function fetchLeagueRosters(sleeperLeagueId: string): Promise<SleeperRoster[] | null> {
  return j<SleeperRoster[]>(`/league/${sleeperLeagueId}/rosters`)
}
