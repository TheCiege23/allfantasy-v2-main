import { prisma } from "@/lib/prisma"
import {
  computeFreshness,
  rollupTrafficLights,
  type FreshnessStatus,
  type TrafficLight,
} from "@/lib/production-health/productionHealthCore"

/**
 * Is each scheduled pipeline still WRITING? Judged by the newest row in the table it
 * writes — never by its cron's status code or its own SyncJobRun row.
 *
 * ⚠ WHY OUTPUT TABLES AND NOT SyncJobRun. Two failure modes this repo has already hit
 * are invisible to a job's own run record:
 *   - a gated cron returns 200 with `reason: "live sync disabled"` and writes nothing
 *     (fantasy-os-exec-sync, 2026-09-02: a ~4h45m outage nothing alerted on);
 *   - a run row stuck at `running` makes computeJobHealth report amber forever, and a
 *     dead job never escalates to red.
 * A table that stopped advancing has neither excuse.
 *
 * ⚠ SCOPE. Raw sports data (games, players, injuries, news, stats, projections) is
 * already measured this way per sport by AdminProviderHealthService, so it is not
 * repeated here. This covers the league / manager / decision pipelines nothing watched.
 *
 * ⚠ ONLY SCHEDULED WRITERS BELONG HERE. A table written when something HAPPENS (a trade
 * observed, a notification sent) has no cadence, so "no write for 3 days" is not a
 * finding — allfantasy_market_player_values and intelligence_manager_snapshot were
 * considered and left out for exactly that reason. Adding one would teach operators to
 * ignore red.
 *
 * ⚠ THESE COLUMNS ARE UNINDEXED (measured 2026-09-22, except the two noted), so each
 * `max()` is a table scan — decision_os_imported_activity is ~38 MB. /admin now refreshes
 * every minute, so the result is cached for CACHE_MS. The thresholds are hours; five
 * minutes of cache cannot move a verdict. Adding indexes is a migration, and a separate
 * decision.
 */

export type PipelineFreshnessRow = {
  id: string
  label: string
  /** The physical table, so an operator can query it directly. */
  table: string
  cadence: string
  lastWriteAt: string | null
  ageHours: number | null
  status: FreshnessStatus | "query_failed"
  trafficLight: TrafficLight
  summary: string
}

export type AdminPipelineFreshness = {
  rows: PipelineFreshnessRow[]
  overall: TrafficLight
  measuredAt: string
}

type PipelineSpec = {
  id: string
  label: string
  table: string
  cadence: string
  /** Amber after this many hours without a write. */
  warnAfterH: number
  /** Red after this many hours without a write. */
  failAfterH: number
  latest: () => Promise<Date | null>
}

/*
 * Thresholds were set against production's measured last writes on 2026-09-22 (NFL
 * in-season) and each writer's schedule in cron-schedule.json: amber at a few missed
 * periods, red when the gap is clearly an outage rather than a slow run.
 */
export const PIPELINE_SPECS: PipelineSpec[] = [
  {
    id: "scheduler",
    label: "Scheduler heartbeat",
    table: "sync_job_runs",
    cadence: "any scheduled job starting — dozens per hour",
    warnAfterH: 0.25,
    failAfterH: 1,
    // Indexed on created_at. A row is written when a job STARTS, so this proves the
    // cron host is firing, not that jobs succeed — the rows below answer that.
    latest: async () =>
      (await prisma.syncJobRun.aggregate({ _max: { createdAt: true } }))._max.createdAt ?? null,
  },
  {
    id: "league-sync",
    label: "League sync",
    table: "league_sync_state",
    cadence: "fantasy-os-exec-sync, every 30 min",
    warnAfterH: 2,
    failAfterH: 6,
    latest: async () =>
      (await prisma.leagueSyncState.aggregate({ _max: { updatedAt: true } }))._max.updatedAt ?? null,
  },
  {
    id: "matchups",
    label: "Matchups & scores",
    table: "WeeklyMatchup",
    cadence: "league sync + score-sync, every 5–30 min in season",
    warnAfterH: 2,
    failAfterH: 6,
    latest: async () =>
      (await prisma.weeklyMatchup.aggregate({ _max: { updatedAt: true } }))._max.updatedAt ?? null,
  },
  {
    id: "rosters",
    label: "Rosters",
    table: "rosters",
    cadence: "league sync, every 30 min",
    warnAfterH: 6,
    failAfterH: 24,
    latest: async () =>
      (await prisma.roster.aggregate({ _max: { updatedAt: true } }))._max.updatedAt ?? null,
  },
  {
    id: "manager-psych",
    label: "Manager psychology",
    table: "manager_psych_profiles",
    cadence: "rotation inside the import run",
    warnAfterH: 24,
    failAfterH: 72,
    latest: async () =>
      (await prisma.managerPsychProfile.aggregate({ _max: { updatedAt: true } }))._max.updatedAt ?? null,
  },
  {
    id: "decision-os-activity",
    label: "Decision OS activity ingest",
    table: "decision_os_imported_activity",
    cadence: "daily 07:00 UTC discover + 6-hourly relay",
    warnAfterH: 30,
    failAfterH: 72,
    latest: async () =>
      (await prisma.decisionOsImportedActivity.aggregate({ _max: { updatedAt: true } }))._max.updatedAt ?? null,
  },
  {
    id: "adp",
    label: "ADP board",
    table: "ai_adp_snapshots",
    cadence: "daily (09:00 + 10:00 UTC)",
    warnAfterH: 30,
    failAfterH: 72,
    // Indexed on computedAt.
    latest: async () =>
      (await prisma.aiAdpSnapshot.aggregate({ _max: { computedAt: true } }))._max.computedAt ?? null,
  },
  {
    id: "depth-charts",
    label: "Depth charts",
    table: "depth_charts",
    cadence: "weekly, Wednesday 04:00 UTC",
    warnAfterH: 8 * 24,
    failAfterH: 15 * 24,
    latest: async () =>
      (await prisma.depthChart.aggregate({ _max: { fetchedAt: true } }))._max.fetchedAt ?? null,
  },
]

/** One slow table must not stall the whole panel — nor the page refresh behind it. */
const QUERY_BUDGET_MS = 5000
const CACHE_MS = 5 * 60_000

const TIMED_OUT = Symbol("timed-out")

/**
 * Pure: turns one pipeline's latest write (or a failed read) into a row.
 *
 * ⚠ A FAILED READ IS "unknown", NEVER "fresh". It is also not "never written" — the
 * table may be fine and the query slow. Both would be a plausible-looking wrong answer.
 */
export function buildPipelineRow(
  spec: Pick<PipelineSpec, "id" | "label" | "table" | "cadence" | "warnAfterH" | "failAfterH">,
  result: { ok: true; latest: Date | null } | { ok: false; reason: string },
  now: number,
): PipelineFreshnessRow {
  const base = { id: spec.id, label: spec.label, table: spec.table, cadence: spec.cadence }
  if (!result.ok) {
    return {
      ...base,
      lastWriteAt: null,
      ageHours: null,
      status: "query_failed",
      trafficLight: "unknown",
      summary: `${spec.label}: could not be measured (${result.reason}).`,
    }
  }
  const report = computeFreshness(result.latest, {
    label: spec.label,
    now,
    thresholds: {
      freshUnderH: spec.warnAfterH,
      staleAfterH: spec.warnAfterH,
      veryStaleAfterH: spec.failAfterH,
    },
  })
  return {
    ...base,
    lastWriteAt: report.lastSyncedAt,
    ageHours: report.ageHours,
    status: report.status,
    trafficLight: report.trafficLight,
    summary: report.summary,
  }
}

async function measure(spec: PipelineSpec) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const work = spec.latest()
    // A query that loses the race and rejects later must still be handled, or it is an
    // unhandled rejection (same reasoning as the growth panel in app/admin/page.tsx).
    work.catch(() => undefined)
    const budget = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), QUERY_BUDGET_MS)
    })
    const latest = await Promise.race([work, budget])
    if (latest === TIMED_OUT) return { ok: false as const, reason: `no answer in ${QUERY_BUDGET_MS / 1000}s` }
    return { ok: true as const, latest }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message.split("\n")[0].slice(0, 120) : "query error"
    return { ok: false as const, reason: message }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

let cached: { at: number; value: AdminPipelineFreshness } | null = null

export async function getAdminPipelineFreshness(
  options: { now?: number; bypassCache?: boolean } = {},
): Promise<AdminPipelineFreshness> {
  const now = options.now ?? Date.now()
  if (!options.bypassCache && cached && now - cached.at < CACHE_MS) return cached.value

  const results = await Promise.all(PIPELINE_SPECS.map((spec) => measure(spec)))
  const rows = PIPELINE_SPECS.map((spec, i) => buildPipelineRow(spec, results[i], now))
  const value: AdminPipelineFreshness = {
    rows,
    overall: rollupTrafficLights(rows.map((row) => row.trafficLight)),
    measuredAt: new Date(now).toISOString(),
  }
  // A result with a failed read is not cached, so the next refresh retries it.
  if (rows.every((row) => row.status !== "query_failed")) cached = { at: now, value }
  return value
}

/** Test seam. */
export function resetPipelineFreshnessCache() {
  cached = null
}
