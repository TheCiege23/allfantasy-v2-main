import 'server-only'

import { projectionCoverageFor } from './projectionCoverage'
import {
  futureWeekProjectionsReady,
  futureWeekStoreReader,
  type FutureWeekCheckRow,
  type FutureWeekStoreReader,
} from './futureWeekProjectionStore'

/**
 * Projected lines for the weeks AFTER the current one — the DB-first read.
 *
 * Reads only `future_week_projections` / `future_week_projection_checks`, which only the future-week
 * phase of /api/cron/import-projections writes. No provider is called from here.
 *
 * 🛑 IT NEVER RETURNS THE CURRENT WEEK OR AN EARLIER ONE. `afterWeek` is the caller's current week
 * (from `latestProjectionWeek()`, the same week every current-week surface uses) and the filter
 * `week > afterWeek` is applied in the SQL AND again here. A future line that has since become the
 * current week is `fantasy_projections`' business; serving it from here would put two different
 * numbers on one week.
 *
 * ⚠ EVERY VALUE CARRIES ITS AS-OF. `asOf` is the last time a successful fetch confirmed Sleeper's
 * board still said this; `lineFetchedAt` is when the number itself last changed. And every week the
 * caller asked about gets a status, so a missing number always has a reason:
 *
 *   published       Sleeper posted lines for the week; a player with no line has none on its board.
 *   not_published   We asked at `confirmedAt` and the board had no projections yet.
 *   unchecked       We have not successfully asked (beyond the horizon, first run pending, or every
 *                   attempt failed). Not a claim about Sleeper at all.
 */

/** A daily cron: a confirmation older than this means the ingest has stopped reaching the week. */
export const FUTURE_WEEK_STALE_MS = 72 * 60 * 60 * 1000

export type FutureWeekStatus =
  | {
      week: number
      state: 'published'
      confirmedAt: string
      changedAt: string | null
      rowCount: number
      stale: boolean
      lastCheckFailed: boolean
    }
  | { week: number; state: 'not_published'; confirmedAt: string; stale: boolean; lastCheckFailed: boolean }
  | { week: number; state: 'unchecked'; reason: string }

export type FutureWeekLine = {
  playerId: string
  week: number
  /** Sleeper's generic PPR points for the week. */
  projectedPoints: number
  /** The component line, for rescoring under a league's own settings. */
  componentStats: Record<string, number> | null
  opponent: string | null
  /** Last successful confirmation of the week's board (ISO). */
  asOf: string
  /** When this number was last written (ISO). */
  lineFetchedAt: string
  basis: 'sleeper-ppr'
}

export type FutureWeekRead =
  | {
      available: true
      season: string
      afterWeek: number
      throughWeek: number
      weeks: Map<number, FutureWeekStatus>
      /** playerId → week → line. Only weeks whose status is `published`. */
      lines: Map<string, Map<number, FutureWeekLine>>
    }
  | { available: false; reason: string }

export type FutureWeekReadDeps = {
  ready: () => Promise<boolean>
  store: FutureWeekStoreReader
  now: () => number
}

const defaultDeps: FutureWeekReadDeps = {
  ready: () => futureWeekProjectionsReady(),
  store: futureWeekStoreReader,
  now: Date.now,
}

const SOURCE = 'sleeper'

export const FUTURE_WEEKS_NOT_ENABLED =
  'Projections for later weeks are not switched on yet — only the current week is published here.'

function iso(d: Date | null | undefined): string | null {
  if (!d) return null
  const t = d instanceof Date ? d.getTime() : new Date(d as unknown as string).getTime()
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

function statusFor(week: number, row: FutureWeekCheckRow | undefined, nowMs: number): FutureWeekStatus {
  if (!row) return { week, state: 'unchecked', reason: `Week ${week} has not been checked yet.` }
  const confirmedAt = iso(row.confirmedAt)
  if (!row.status || !confirmedAt) {
    return { week, state: 'unchecked', reason: `Every attempt to fetch week ${week} so far has failed.` }
  }
  const stale = nowMs - Date.parse(confirmedAt) > FUTURE_WEEK_STALE_MS
  const checkedAt = iso(row.checkedAt)
  const lastCheckFailed = Boolean(row.lastError) && checkedAt != null && Date.parse(checkedAt) > Date.parse(confirmedAt)
  if (row.status === 'published') {
    return {
      week,
      state: 'published',
      confirmedAt,
      changedAt: iso(row.changedAt),
      rowCount: row.rowCount,
      stale,
      lastCheckFailed,
    }
  }
  return { week, state: 'not_published', confirmedAt, stale, lastCheckFailed }
}

function componentStats(stats: unknown): Record<string, number> | null {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return null
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(stats as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return out
}

export async function readFutureWeekProjections(
  input: { season: string; afterWeek: number; throughWeek: number; playerIds: readonly string[]; sport?: string | null },
  deps: FutureWeekReadDeps = defaultDeps,
): Promise<FutureWeekRead> {
  const sport = String(input.sport ?? 'NFL').trim().toUpperCase()
  const coverage = projectionCoverageFor(sport)
  if (!coverage.weeklyFeedAvailable) {
    return { available: false, reason: coverage.reason ?? 'No weekly projection feed for this sport.' }
  }
  if (!Number.isInteger(input.afterWeek) || !Number.isInteger(input.throughWeek)) {
    return { available: false, reason: 'No current week to project forward from.' }
  }
  if (!(await deps.ready())) return { available: false, reason: FUTURE_WEEKS_NOT_ENABLED }

  const weeks = new Map<number, FutureWeekStatus>()
  const lines = new Map<string, Map<number, FutureWeekLine>>()
  if (input.throughWeek <= input.afterWeek) {
    return { available: true, season: input.season, afterWeek: input.afterWeek, throughWeek: input.throughWeek, weeks, lines }
  }

  const range = {
    sport,
    season: input.season,
    source: SOURCE,
    afterWeek: input.afterWeek,
    throughWeek: input.throughWeek,
  }
  const [checks, rows] = await Promise.all([
    deps.store.readChecks(range),
    deps.store.readLines({ ...range, playerIds: input.playerIds }),
  ])

  const nowMs = deps.now()
  const byWeek = new Map(checks.map((c) => [c.week, c]))
  for (let w = input.afterWeek + 1; w <= input.throughWeek; w += 1) weeks.set(w, statusFor(w, byWeek.get(w), nowMs))

  for (const r of rows) {
    // Defence in depth: the SQL already bounds the range.
    if (r.week <= input.afterWeek || r.week > input.throughWeek) continue
    const status = weeks.get(r.week)
    // A line is served only under a week the checks table says is published — otherwise its as-of
    // would be invented.
    if (!status || status.state !== 'published') continue
    const points = Number(r.projectedPoints)
    if (!Number.isFinite(points)) continue
    const perPlayer = lines.get(r.playerId) ?? new Map<number, FutureWeekLine>()
    perPlayer.set(r.week, {
      playerId: r.playerId,
      week: r.week,
      projectedPoints: points,
      componentStats: componentStats(r.stats),
      opponent: r.opponent,
      asOf: status.confirmedAt,
      lineFetchedAt: iso(r.fetchedAt) ?? status.confirmedAt,
      basis: 'sleeper-ppr',
    })
    lines.set(r.playerId, perPlayer)
  }

  return { available: true, season: input.season, afterWeek: input.afterWeek, throughWeek: input.throughWeek, weeks, lines }
}
