import { CLASS_MODEL_VERSION, classify, replay } from '@/lib/class-rating/engine'
import { buildRatingInputs } from '@/lib/class-rating/inputs'
import { drainClassRecaps, queueClassRecaps } from '@/lib/class-rating/recap'
import {
  classTablesReady,
  loadFactRows,
  loadLeagueMeta,
  readClassRatingState,
  replaceClassRatings,
  writeClassRatingState,
} from '@/lib/class-rating/store'

/**
 * The daily Class rating run — rides `/api/cron/domain-os-refresh`, like the rankings snapshot.
 *
 * Once per Eastern day it reads the matchup facts, and only when they produce a DIFFERENT
 * input than the last rebuild (same hash → same ratings, by construction) does it replay and
 * replace the tables. In season that is roughly weekly: a week is only rated once the league
 * has moved past it (see `makeCompleteWeekTest`).
 *
 * It never throws. Every outcome is a count, and `failed` / `errors` reach the run telemetry.
 * `CLASS_RATING_DISABLED=true` turns it off.
 */

export type ClassRatingCounts = {
  date: string | null
  /** Why nothing was rebuilt, when nothing was. */
  skipped: null | 'disabled' | 'tables_missing' | 'already_ran_today' | 'unchanged_input' | 'no_time'
  rebuilt: number
  games: number
  people: number
  established: number
  events: number
  ms: number
  failed: number
  /** Weekly recaps queued after this rebuild, and sent this fire (only with CLASS_RECAP_NOTIFICATIONS=true). */
  recapQueued: number
  recapSent: number
  recapFailed: number
  errors: string[]
}

export function emptyClassRatingCounts(): ClassRatingCounts {
  return {
    date: null,
    skipped: null,
    rebuilt: 0,
    games: 0,
    people: 0,
    established: 0,
    events: 0,
    ms: 0,
    failed: 0,
    recapQueued: 0,
    recapSent: 0,
    recapFailed: 0,
    errors: [],
  }
}

/** The calendar day in New York — the same day key the rankings snapshot uses. */
export function easternDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** The rebuild's own deadline, inside whatever the caller has left. */
const REBUILD_TIMEOUT_MS = 120_000
/** Below this much caller budget the run waits for the next fire instead of racing the edge. */
export const MIN_BUDGET_MS = 150_000

export async function runClassRatingDaily(
  now: Date = new Date(),
  opts: { remainingMs?: () => number } = {},
): Promise<ClassRatingCounts> {
  const out = emptyClassRatingCounts()
  const started = Date.now()
  if (String(process.env.CLASS_RATING_DISABLED ?? '').toLowerCase() === 'true') {
    out.skipped = 'disabled'
    return out
  }
  out.date = easternDay(now)
  try {
    if (!(await classTablesReady())) {
      out.skipped = 'tables_missing'
      return out
    }
    const state = await readClassRatingState()
    if (state?.date === out.date) {
      out.skipped = 'already_ran_today'
      return out
    }
    if (opts.remainingMs && opts.remainingMs() < MIN_BUDGET_MS) {
      out.skipped = 'no_time'
      return out
    }

    const rows = await loadFactRows()
    const leagues = await loadLeagueMeta(rows.map((r) => r.leagueId))
    const inputs = buildRatingInputs(rows, leagues)
    out.games = inputs.counts.kept
    if (state?.inputHash === inputs.inputHash) {
      out.skipped = 'unchanged_input'
      await writeClassRatingState({ ...state, date: out.date }, now)
      return out
    }

    const { ratings, events } = await replay(inputs.games, { yieldEveryPeriods: 5 })
    const classified = classify(ratings)
    const written = await replaceClassRatings({
      classified,
      events,
      claimedBy: inputs.claimedBy,
      computedAt: now,
      timeoutMs: REBUILD_TIMEOUT_MS,
    })
    // State last: a rebuild that failed above leaves the old hash, so the next fire retries.
    await writeClassRatingState({ date: out.date, inputHash: inputs.inputHash, computedAt: now.toISOString() }, now)
    out.rebuilt = 1
    out.people = written.ratings
    out.events = written.events
    out.established = [...classified.values()].filter((c) => c.established).length
    // After the tables hold the new week, never before; a recap failure must not fail the rating.
    const queued = await queueClassRecaps(now).catch((e: unknown) => {
      out.errors.push(`class_recap_queue: ${e instanceof Error ? e.message : String(e)}`)
      return null
    })
    out.recapQueued = queued?.queued ?? 0
  } catch (e) {
    out.failed = 1
    out.errors.push(`class_rating(${CLASS_MODEL_VERSION}): ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    // Every fire drains a batch of queued recaps — a no-op unless CLASS_RECAP_NOTIFICATIONS=true.
    const drained = await drainClassRecaps(now).catch((e: unknown) => {
      out.errors.push(`class_recap_send: ${e instanceof Error ? e.message : String(e)}`)
      return null
    })
    if (drained) {
      out.recapSent = drained.sent
      out.recapFailed = drained.failed
      out.errors.push(...drained.errors.slice(0, 5))
    }
    out.ms = Date.now() - started
  }
  return out
}
