import { createHash } from 'node:crypto'

import { remainingFor } from '@/lib/cron/runBudget'
import type { WeekBoard } from '@/lib/sports-data/sleeperMarketService'
import type { FutureWeekLineInput, FutureWeekStoreWriter } from './futureWeekProjectionStore'

/**
 * The future-week phase of /api/cron/import-projections: Sleeper's projection board for the weeks
 * AFTER the current one, stored in `future_week_projections` — never `fantasy_projections`.
 *
 * ── Provider, endpoint, id space, scoring basis ──────────────────────────────────────────────────
 * The same feed the current-week phase already writes from: `getWeekBoard(season, week)` in
 * lib/sports-data/sleeperMarketService.ts, i.e. Sleeper's public `projections/nfl/{season}/{week}`
 * board (RotoWire's lines). Keyed by Sleeper player id — the id space roster starters and the
 * Sleeper rows of `fantasy_projections` already use. `projectedPoints` is the board's own generic
 * `pts_ppr`; the full component line rides in `stats` so a league can rescore it.
 *
 * ⚠ HOW FAR AHEAD SLEEPER PUBLISHES IS NOT KNOWN. There is no committed Sleeper contract, and
 * Rolling Insights has no projection endpoint at all (contracts/rolling-insights/ENDPOINTS.yaml:
 * "There are NO odds and NO projection endpoints for any sport"). The one observation on record is
 * indirect: the importer's old date guess ran a week ahead and still found real lines from each
 * Tuesday, so next week's board is populated at least that early. Beyond that is recorded as a gap
 * in contracts/sleeper/GAPS.md, and this phase is written so an unpublished week is an honest
 * "not published yet" — a board with no projected points — never an error.
 *
 * ── Change detection ─────────────────────────────────────────────────────────────────────────────
 * Sleeper is not Rolling Insights, so the 304 rule does not apply; but the same principle does:
 * change is detected by hashing the canonical payload, never by status. An unchanged board is
 * CONFIRMED (its as-of moves forward) without rewriting a row.
 *
 * ── Budget ───────────────────────────────────────────────────────────────────────────────────────
 * Runs after the current-week phase inside the same request, so it can never delay or fail it. A
 * week is ADMITTED only while the deadline leaves time (`remainingFor`, checked between weeks), and
 * each board fetch is raced against what is left. Nearest week first: when the run is cut short it is
 * the farthest week that waits for tomorrow.
 */

/** Weeks after the current one to hold. Four matches the player card's five-week schedule strip. */
export const FUTURE_WEEK_HORIZON = 4
/** Sleeper's board is requested with `season_type=regular`; there is no regular week past this. */
export const NFL_FINAL_REGULAR_WEEK = 18
export const FUTURE_WEEK_SOURCE = 'sleeper'
export const FUTURE_WEEK_SCORING_PRESET = 'ppr'
/** Cap on one board fetch, further clamped to the time actually left. */
export const FUTURE_WEEK_FETCH_CAP_MS = 30_000

/** The weeks this phase covers for a given current week: anchor+1 … anchor+horizon, regular season only. */
export function futureWeeksFor(anchorWeek: number, horizon: number = FUTURE_WEEK_HORIZON): number[] {
  const out: number[] = []
  if (!Number.isInteger(anchorWeek) || anchorWeek < 0) return out
  for (let w = anchorWeek + 1; w <= anchorWeek + horizon && w <= NFL_FINAL_REGULAR_WEEK; w += 1) out.push(w)
  return out
}

/**
 * The lines a board actually projects, sorted by player id.
 *
 * A row counts only when it carries a finite `pts_ppr` — the same rule the current-week phase uses.
 * A board whose rows all lack one is a week Sleeper has not projected yet.
 */
export function canonicalBoardLines(board: WeekBoard): FutureWeekLineInput[] {
  const out: FutureWeekLineInput[] = []
  for (const p of Object.values(board.players ?? {})) {
    const points = p?.stats?.pts_ppr
    if (!p?.playerId || typeof points !== 'number' || !Number.isFinite(points)) continue
    const stats: Record<string, number> = {}
    for (const [k, v] of Object.entries(p.stats)) {
      if (typeof v === 'number' && Number.isFinite(v)) stats[k] = v
    }
    out.push({ playerId: String(p.playerId), projectedPoints: points, stats, opponent: p.opponent ?? null })
  }
  out.sort((a, b) => (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0))
  return out
}

/** sha256 over the canonical lines, stat keys sorted, so key order in the feed cannot move it. */
export function hashBoardLines(lines: readonly FutureWeekLineInput[]): string {
  const canonical = lines.map((l) => [
    l.playerId,
    l.projectedPoints,
    l.opponent,
    Object.keys(l.stats)
      .sort()
      .map((k) => [k, l.stats[k]]),
  ])
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export type FutureWeekOutcome = {
  week: number
  outcome: 'written' | 'unchanged' | 'not_published' | 'error' | 'deferred'
  lines?: number
  error?: string
}

export type FutureWeekIngestReport = {
  anchorWeek: number
  horizon: number
  weeks: FutureWeekOutcome[]
  pruned: number | null
  pruneError?: string
}

export type FutureWeekIngestDeps = {
  getBoard: (season: string, week: number) => Promise<WeekBoard | null>
  store: FutureWeekStoreWriter
  now?: () => Date
}

function errorText(err: unknown): string {
  // Never a URL: getWeekBoard swallows its own fetch errors, and nothing here builds one.
  const msg = err instanceof Error ? err.message : String(err)
  return msg.slice(0, 240)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`board fetch timed out after ${ms}ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

export async function ingestFutureWeeks(
  input: { sport: 'NFL'; season: string; anchorWeek: number; horizon?: number; deadlineAt: number },
  deps: FutureWeekIngestDeps,
): Promise<FutureWeekIngestReport> {
  const horizon = input.horizon ?? FUTURE_WEEK_HORIZON
  const now = deps.now ?? (() => new Date())
  const report: FutureWeekIngestReport = { anchorWeek: input.anchorWeek, horizon, weeks: [], pruned: null }

  // Retire the week that just became current (and everything earlier, and other seasons) first, so
  // the table only ever holds weeks that are still in the future.
  try {
    report.pruned = await deps.store.pruneThrough({ sport: input.sport, season: input.season, throughWeek: input.anchorWeek })
  } catch (err) {
    report.pruneError = errorText(err)
  }

  const weeks = futureWeeksFor(input.anchorWeek, horizon)
  for (let i = 0; i < weeks.length; i += 1) {
    const week = weeks[i]!
    const budget = remainingFor(input.deadlineAt, FUTURE_WEEK_FETCH_CAP_MS)
    if (budget == null) {
      for (const w of weeks.slice(i)) report.weeks.push({ week: w, outcome: 'deferred' })
      break
    }

    const key = { sport: input.sport, season: input.season, week, source: FUTURE_WEEK_SOURCE }
    try {
      const board = await withTimeout(deps.getBoard(input.season, week), budget)
      const at = now()
      if (!board) {
        const error = 'Sleeper returned no board for this week (request failed or non-2xx).'
        await deps.store.recordWeekError({ ...key, anchorWeek: input.anchorWeek, error, at })
        report.weeks.push({ week, outcome: 'error', error })
        continue
      }

      const lines = canonicalBoardLines(board)
      if (lines.length === 0) {
        await deps.store.confirmWeek({
          ...key,
          anchorWeek: input.anchorWeek,
          status: 'not_published',
          rowCount: 0,
          payloadHash: null,
          at,
        })
        report.weeks.push({ week, outcome: 'not_published', lines: 0 })
        continue
      }

      const payloadHash = hashBoardLines(lines)
      const prior = await deps.store.readCheck(key)
      if (prior && prior.status === 'published' && prior.payloadHash === payloadHash) {
        await deps.store.confirmWeek({
          ...key,
          anchorWeek: input.anchorWeek,
          status: 'published',
          rowCount: lines.length,
          payloadHash,
          at,
        })
        report.weeks.push({ week, outcome: 'unchanged', lines: lines.length })
        continue
      }

      const written = await deps.store.replaceWeek({
        ...key,
        anchorWeek: input.anchorWeek,
        scoringPresetId: FUTURE_WEEK_SCORING_PRESET,
        lines,
        payloadHash,
        at,
      })
      report.weeks.push({ week, outcome: 'written', lines: written })
    } catch (err) {
      const error = errorText(err)
      await deps.store
        .recordWeekError({ ...key, anchorWeek: input.anchorWeek, error, at: now() })
        .catch(() => undefined)
      report.weeks.push({ week, outcome: 'error', error })
    }
  }

  return report
}
