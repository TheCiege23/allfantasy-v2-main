/**
 * Fetches full Sleeper league data (league, users, rosters, matchups, transactions, draft, player map).
 * Used by import preview and by league creation from import.
 */

import pLimit from 'p-limit'

import { getAllPlayers } from '@/lib/sleeper-client'
import type { SleeperImportPayload } from '../adapters/sleeper/types'

const FETCH_RETRIES = 3
const FETCH_TIMEOUT_MS = 12000

/**
 * A ceiling on how many Sleeper requests this process has in flight at once.
 *
 * 🛑 WITHOUT THIS, A BULK IMPORT IS A BURST OF ~288 SIMULTANEOUS REQUESTS.
 * `fetchSleeperLeagueForImport` fans out 18 transaction weeks and 18 matchup weeks
 * through `Promise.all` — ~40 requests for one league, past 70 for a ten-year dynasty
 * chain. `/api/import-sleeper` then runs 8 leagues concurrently (`pLimit(8)`), so the
 * two multiply: the per-league fan-out was bounded and the number of leagues was
 * bounded, and nobody bounded the product.
 *
 * That is the shape that produces the bug this file's `SleeperImportUnavailableError`
 * exists to report: one league in an otherwise clean run of thirty gets throttled, and
 * the user is told a league they just picked off a Sleeper-supplied list does not exist.
 * Explaining the throttle is worth doing; not causing it is worth more.
 *
 * ⚠ MODULE-LEVEL ON PURPOSE — the cap is per process, not per league. A per-call
 * limiter would bound one league's fan-out and leave the multiplication untouched,
 * which is the state this replaces.
 *
 * ⚠ IT DOES NOT REPLACE THE RETRY. A cap makes a 429 unlikely, not impossible: other
 * instances share the same quota and Sleeper's limit is account-wide, not ours to see.
 * Backoff stays.
 */
const sleeperRequestLimit = pLimit(10)

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Sleeper answered, but not with the league — a rate limit, a 5xx, or a timeout that
 * survived every retry.
 *
 * 🛑 THIS EXISTS BECAUSE "NO SUCH LEAGUE" AND "WE COULD NOT REACH SLEEPER" WERE THE SAME
 * RETURN VALUE, AND THE PRODUCT REPORTED THE WRONG ONE. `fetchSleeperJson` answers `null`
 * for a genuine 404 AND for exhausted retries; the league guard below then returned `null`
 * for both, and `ImportedLeagueNormalizationPipeline` turned that into "League not found.
 * Please check your League ID." — said to someone who had just picked that league off a
 * list Sleeper itself supplied moments earlier.
 *
 * That is worse than an unhelpful message. It is a confident, wrong diagnosis that sends
 * the user to check an ID that was never the problem, and it hides the one condition a
 * bulk import actually produces: one league in a long run getting throttled. A single
 * league import fans out ~40 requests and a ten-year dynasty chain passes 70, so a run
 * over 30 leagues is thousands of calls to `api.sleeper.app` with no pacing anywhere.
 *
 * ⚠ THE `status` IS CARRIED, NOT JUST THE TEXT. 429 is "wait and it will work", 5xx is
 * "their side, retry shortly", and a network timeout is neither — they imply different
 * next actions for the user and different retry behaviour for us, so callers get the
 * number rather than having to parse a sentence.
 */
export class SleeperImportUnavailableError extends Error {
  readonly status: number | null
  readonly warnings: string[]

  constructor(message: string, options: { status: number | null; warnings: string[] }) {
    super(message)
    this.name = 'SleeperImportUnavailableError'
    this.status = options.status
    this.warnings = options.warnings
  }
}

/** One fetch that failed for a reason other than "Sleeper says this does not exist". */
interface SleeperFetchFailure {
  label: string
  /** HTTP status when Sleeper answered; `null` for a timeout or network error. */
  status: number | null
  message: string
}

/**
 * The sentence the user reads on a failed row.
 *
 * Each branch names what happened AND what to do, because the whole point of this
 * change is that "Failed" with no actionable reason makes Retry a coin flip. A 429
 * will succeed on a retry; a 404 never will; and the user cannot tell those apart
 * from the outcome alone.
 *
 * ⚠ NO LEAGUE ID AND NO URL. This string reaches the browser, and a Sleeper league id
 * is the user's own data — the row it lands on already says which league it is.
 */
function describeSleeperUnavailable(failure: SleeperFetchFailure): string {
  if (failure.status === 429) {
    return 'Sleeper is rate-limiting us right now — this league is fine. Wait about a minute and retry.'
  }
  if (failure.status != null && failure.status >= 500) {
    return `Sleeper's API is having trouble (HTTP ${failure.status}). That is on their side — retry shortly.`
  }
  if (failure.status != null) {
    return `Sleeper refused the request (HTTP ${failure.status}). Retry shortly; if it keeps happening the league may be private.`
  }
  return 'We could not reach Sleeper after three attempts — the request timed out. Retry shortly.'
}

interface SleeperFetchContext {
  warnings: string[]
  /**
   * Structured mirror of `warnings`. The strings are for humans reading an import's
   * warning list; this is what code reads to tell a 429 from a 503 from a timeout.
   * Kept alongside rather than replacing `warnings` because the persisted
   * `ImportWarning` rows are built from the strings and their shape is depended on.
   */
  failures: SleeperFetchFailure[]
  label: string
}

/**
 * Phase 2.3 — resilient Sleeper GET. Retries transient failures (network / timeout /
 * 5xx / 429) with exponential backoff and a per-request timeout. A 404 or an
 * ok-but-empty body is legitimate "no data" (e.g. a week beyond the season) and is NOT
 * a warning. A persistent failure pushes a message to `ctx.warnings` (never silently
 * swallowed) and returns null so the caller keeps whatever partial data it has. When
 * `ctx` is omitted the call still retries — it just doesn't record a warning.
 */
async function fetchSleeperJson<T>(
  url: string,
  ctx?: SleeperFetchContext,
): Promise<T | null> {
  for (let attempt = 0; attempt < FETCH_RETRIES; attempt++) {
    try {
      /*
       * Queued, not fired — the limiter above bounds how many of these are in flight.
       *
       * ⚠ THE TIMEOUT STARTS INSIDE THE QUEUE SLOT, NOT BEFORE IT, and that is the whole
       * reason this block is shaped this way. Creating the AbortController outside the
       * limiter would start a 12s clock while the request is still waiting its turn, so
       * under a burst the queue itself would abort requests that had never been sent —
       * turning a working import into a wave of spurious timeouts, and turning the
       * limiter from a fix into a new bug. The budget must cover the request, not the
       * wait for a slot.
       */
      const res = await sleeperRequestLimit(async () => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
        try {
          return await fetch(url, { signal: controller.signal })
        } finally {
          clearTimeout(timer)
        }
      })
      if (res.status === 404) return null // legitimate no-data
      if (!res.ok) {
        if (attempt < FETCH_RETRIES - 1) {
          await delay(300 * 2 ** attempt)
          continue
        }
        ctx?.warnings.push(
          `${ctx.label}: Sleeper returned ${res.status} after ${FETCH_RETRIES} attempts — data may be incomplete.`,
        )
        ctx?.failures.push({
          label: ctx.label,
          status: res.status,
          message: `Sleeper returned ${res.status} after ${FETCH_RETRIES} attempts`,
        })
        return null
      }
      return (await res.json()) as T
    } catch (err) {
      if (attempt < FETCH_RETRIES - 1) {
        await delay(300 * 2 ** attempt)
        continue
      }
      const detail = err instanceof Error ? err.message : 'network error'
      ctx?.warnings.push(
        `${ctx.label}: Sleeper request failed after ${FETCH_RETRIES} attempts (${detail}) — data may be incomplete.`,
      )
      ctx?.failures.push({
        label: ctx.label,
        status: null,
        message: `Sleeper request failed after ${FETCH_RETRIES} attempts (${detail})`,
      })
      return null
    }
  }
  return null
}

const SLEEPER_BASE = 'https://api.sleeper.app/v1' // db-first-exception: ingestion service endpoint

interface SleeperDraftSummaryRaw {
  draft_id: string
  type?: string
  status?: string
  start_time?: number
  slot_to_roster_id?: Record<string, string>
}

export interface SleeperFetchOptions {
  maxMatchupWeeks?: number
  maxTransactionWeeks?: number
  maxPreviousSeasons?: number
}

const DEFAULTS: SleeperFetchOptions = {
  maxMatchupWeeks: 18,
  maxTransactionWeeks: 18,
  maxPreviousSeasons: 10,
}

async function fetchLeagueDraftPicks(
  leagueId: string,
  season?: string
): Promise<NonNullable<SleeperImportPayload['draftPicks']>> {
  const drafts =
    (await fetchSleeperJson<SleeperDraftSummaryRaw[]>(`${SLEEPER_BASE}/league/${leagueId}/drafts`)) ?? []

  let picks: NonNullable<SleeperImportPayload['draftPicks']> = []
  for (const draft of drafts) {
    const draftId = draft?.draft_id?.trim()
    if (!draftId) continue

    const draftPicks =
      (await fetchSleeperJson<NonNullable<SleeperImportPayload['draftPicks']>>(
        `${SLEEPER_BASE}/draft/${draftId}/picks`
      )) ?? []

    if (!draftPicks.length) continue

    picks = picks.concat(
      draftPicks.map((pick) => ({
        ...pick,
        season: season ?? pick.season,
        draft_id: draftId,
      }))
    )
  }

  return picks
}

/**
 * Fetch a full Sleeper league payload suitable for ImportNormalizationPipeline and legacy-style preview.
 */
export async function fetchSleeperLeagueForImport(
  leagueId: string,
  options: SleeperFetchOptions = {}
): Promise<SleeperImportPayload | null> {
  const opts = { ...DEFAULTS, ...options }
  const cleanId = leagueId.trim()
  if (!cleanId) return null

  // Phase 2.3 — collect non-fatal fetch failures instead of silently dropping data.
  const warnings: string[] = []
  const failures: SleeperFetchFailure[] = []
  const ctx = (label: string): SleeperFetchContext => ({ warnings, failures, label })

  const league = await fetchSleeperJson<SleeperImportPayload['league']>(
    `${SLEEPER_BASE}/league/${cleanId}`,
    ctx('league'),
  )
  if (!league?.league_id) {
    /*
     * ⚠ THE TWO REASONS THIS IS EMPTY ARE NOT THE SAME ANSWER. A 404 means Sleeper
     * looked and there is no such league — `null` is right, and the caller's "check
     * your League ID" is the correct thing to say. Exhausted retries mean we never
     * got an answer at all, and saying "not found" there is a wrong diagnosis
     * pointing the user at an ID that was never the problem.
     *
     * `failures` is the discriminator: `fetchSleeperJson` records an entry only on
     * the second path, never on a 404. Before this, both returned `null` and the
     * `warnings` array explaining which one it was went out of scope with the
     * payload that would have carried it.
     */
    const leagueFailure = failures.find((f) => f.label === 'league')
    if (leagueFailure) {
      throw new SleeperImportUnavailableError(describeSleeperUnavailable(leagueFailure), {
        status: leagueFailure.status,
        warnings,
      })
    }
    return null
  }

  const [users, rosters, currentDraftPicks, tradedPicksRaw] = await Promise.all([
    fetchSleeperJson<SleeperImportPayload['users']>(`${SLEEPER_BASE}/league/${cleanId}/users`, ctx('league users')),
    fetchSleeperJson<SleeperImportPayload['rosters']>(`${SLEEPER_BASE}/league/${cleanId}/rosters`, ctx('league rosters')),
    fetchLeagueDraftPicks(cleanId, league.season),
    // Block F — future traded draft picks (`/league/{id}/traded_picks`). Empty [] is
    // a legitimate result (no picks currently traded), NOT a warning. The resilient
    // fetcher records a warning only on 5xx/timeout after retries.
    fetchSleeperJson<SleeperImportPayload['tradedPicks']>(
      `${SLEEPER_BASE}/league/${cleanId}/traded_picks`,
      ctx('traded picks'),
    ),
  ])

  // Phase 2.3 — weekly matchup + transaction fetches run in parallel (were sequential,
  // up to 36 blocking round-trips). Promise.all preserves order; a failed week records a
  // warning via the resilient fetcher rather than being silently skipped.
  const txWeeks = Array.from({ length: opts.maxTransactionWeeks ?? 18 }, (_, i) => i + 1)
  const matchupWeeks = Array.from({ length: opts.maxMatchupWeeks ?? 18 }, (_, i) => i + 1)

  const [txResults, matchupResults] = await Promise.all([
    Promise.all(
      txWeeks.map((week) =>
        fetchSleeperJson<SleeperImportPayload['transactions']>(
          `${SLEEPER_BASE}/league/${cleanId}/transactions/${week}`,
          ctx(`transactions week ${week}`),
        ).then((wk) => ({ week, wk })),
      ),
    ),
    Promise.all(
      matchupWeeks.map((week) =>
        fetchSleeperJson<{ roster_id: number; matchup_id: number; points: number }[]>(
          `${SLEEPER_BASE}/league/${cleanId}/matchups/${week}`,
          ctx(`matchups week ${week}`),
        ).then((m) => ({ week, m })),
      ),
    ),
  ])

  /*
   * ⚠ STAMP THE WEEK HERE, WHERE IT IS AUTHORITATIVE, BECAUSE THE FLATTEN DESTROYS IT.
   *
   * The endpoint is per-week, so `week` is known at the call site — but this loop used to
   * concatenate the arrays and drop it, leaving downstream code with no way to tell which week a
   * transaction belonged to. `persistTradesForSeason` writes `LeagueTrade.week`, and the
   * historical importer only has that column filled because IT keeps its own loop variable
   * (`sleeper-historical.ts` iterates weeks for exactly this reason).
   *
   * Deliberately not read off the payload: Sleeper does return a `leg` field, but nothing in this
   * repo's contracts pins it and CLAUDE.md forbids probing a provider to establish a shape. The
   * loop variable needs no such evidence.
   */
  let transactions: SleeperImportPayload['transactions'] = []
  for (const { week, wk } of txResults) {
    if (wk?.length) transactions = transactions.concat(wk.map((t) => ({ ...t, week })))
  }

  let draftPicks: NonNullable<SleeperImportPayload['draftPicks']> = currentDraftPicks ?? []

  const matchupsByWeek: NonNullable<SleeperImportPayload['matchupsByWeek']> = []
  for (const { week, m } of matchupResults) {
    if (m?.length) matchupsByWeek.push({ week, matchups: m })
  }

  let previousSeasons: SleeperImportPayload['previousSeasons'] = []
  let prevId = league.previous_league_id
  while (prevId && previousSeasons.length < (opts.maxPreviousSeasons ?? 10)) {
    const prevLeague = await fetchSleeperJson<SleeperImportPayload['league']>(
      `${SLEEPER_BASE}/league/${prevId}`,
      ctx(`previous season league ${prevId}`),
    )
    if (!prevLeague) break
    previousSeasons.push({ season: prevLeague.season, league: prevLeague })
    const prevDraftPicks = await fetchLeagueDraftPicks(prevLeague.league_id, prevLeague.season)
    if (prevDraftPicks.length) {
      draftPicks = draftPicks.concat(prevDraftPicks)
    }
    prevId = prevLeague.previous_league_id
  }

  const allPlayerIds = new Set<string>()
  rosters?.forEach((r) => {
    r.players?.forEach((p) => allPlayerIds.add(p))
    r.starters?.forEach((s) => s && s !== '0' && allPlayerIds.add(s))
  })
  draftPicks.forEach((p) => {
    if (p?.player_id) {
      allPlayerIds.add(p.player_id)
    }
  })

  const playerMap: Record<string, { name: string; position: string; team: string }> = {}
  try {
    const sleeperPlayers = await getAllPlayers()
    allPlayerIds.forEach((pid) => {
      const sp = sleeperPlayers[pid]
      if (sp) {
        playerMap[pid] = {
          name: (sp as any).full_name || `${(sp as any).first_name ?? ''} ${(sp as any).last_name ?? ''}`.trim(),
          position: (sp as any).position ?? '',
          team: (sp as any).team ?? '',
        }
      }
    })
  } catch {}

  draftPicks.forEach((p) => {
    if (p?.player_id && p.metadata && !playerMap[p.player_id]) {
      playerMap[p.player_id] = {
        name: `${p.metadata.first_name ?? ''} ${p.metadata.last_name ?? ''}`.trim(),
        position: p.metadata.position ?? '',
        team: p.metadata.team ?? '',
      }
    }
  })

  return {
    league,
    users: users ?? undefined,
    rosters: rosters ?? undefined,
    matchupsByWeek,
    transactions,
    draftPicks,
    // Block F — pass through the raw traded_picks response. Null-safety: the
    // resilient fetcher returns null on unrecoverable failures; treat that as
    // "no traded picks known" so downstream code never explodes.
    tradedPicks: Array.isArray(tradedPicksRaw) ? tradedPicksRaw : undefined,
    playerMap,
    previousSeasons,
    fetchWarnings: warnings.length > 0 ? warnings : undefined,
  }
}
