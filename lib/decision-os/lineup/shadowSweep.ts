import 'server-only'

import { prisma as defaultPrisma } from '@/lib/prisma'
import { computeLineupActionsForUser } from '@/lib/lineup-actions/computeLineupActionsForUser'
import { runLineupShadowForSummary, type LineupShadowResult } from './shadow'
import type { LineupActionSummaryPayload } from '@/lib/lineup-actions/types'

/**
 * Drive the lineup shadow from a schedule instead of from user traffic.
 *
 * WHY THIS EXISTS
 * The flip gate needs >=50 real comparisons per surface before that surface can leave shadow
 * mode. Every route that emits lineup parity is unreachable from the UI. Over 24h of production:
 *
 *     /api/dashboard/today-actions    0 requests
 *     /api/today/lineup-actions       0 requests
 *     /api/redraft/trade-proposals    0 requests
 *
 * That is not "no users" -- over the same window `/` served 1575 and `/dashboard` 864. The cause
 * is a client orphan: `DashboardOverview` still fetches `/api/dashboard/today-actions`, but the
 * only component importing it is `DashboardShell`, which `/dashboard` stopped rendering in
 * 85aae2df2 (2026-07-18) when it cut over to the Nocturne dashboard. No lineup parity evidence
 * has been produced since that date, and organic traffic will never accumulate the gate's 50.
 *
 * A schedule does not care whether a screen is wired. This is the cheapest way to make the gate
 * evaluable again, and it is honest about what it finds: when the shadow cannot run for a league
 * it records a SKIP with a reason, and those reasons are the diagnosis of why the gate cannot
 * accumulate.
 *
 * EVALUATION ONLY. `runLineupShadowForSummary` never sets a lineup, never writes to a league, and
 * never touches a user-visible response. Its only side effect is parity telemetry, which the
 * shadow emits itself -- the counters below exist for the cron's response, not to drive anything.
 */

/** Off by default, and the value must be EXACTLY 'true' -- matching every other Decision OS gate. */
export const SHADOW_SWEEP_FLAG = 'DECISION_OS_SHADOW_SWEEP_ENABLED' as const

export function shadowSweepEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SHADOW_SWEEP_FLAG] === 'true'
}

export interface ShadowSweepResult {
  ran: boolean
  reason?: string
  usersConsidered: number
  usersSwept: number
  comparisons: number
  skips: number
  skipReasons: Record<string, number>
  errors: number
  elapsedMs: number
  offset: number
}

export interface ShadowSweepDeps {
  listCandidateUserIds: (limit: number, offset: number) => Promise<string[]>
  countCandidates: () => Promise<number>
  computeSummary: (userId: string) => Promise<LineupActionSummaryPayload>
  runShadow: (
    userId: string,
    summary: LineupActionSummaryPayload,
    opts: { maxLeagues?: number; leagueOffset?: number },
  ) => Promise<LineupShadowResult[]>
  now: () => number
}

/**
 * Users per tick. Deliberately small: `computeLineupActionsForUser` fans out across a user's
 * leagues and rosters, and this repo has already taken one production Postgres OOM from an
 * unbounded dashboard fan-out. Volume comes from the schedule, not from the batch size.
 */
const DEFAULT_BATCH = 3

/**
 * Wall-clock ceiling. The host route declares maxDuration 60 and also runs the maintenance drain,
 * so the sweep leaves room rather than consuming the budget. A Vercel duration kill runs NO user
 * code, so anything relying on cleanup after the fact simply would not happen.
 */
const DEFAULT_BUDGET_MS = 20_000

/** Rotation period. Matches the host cron's ten-minute cadence. */
const ROTATION_BUCKET_MS = 10 * 60 * 1000

export function productionSweepDeps(db: typeof defaultPrisma = defaultPrisma): ShadowSweepDeps {
  return {
    // groupBy, NOT findMany+distinct. Prisma applies `distinct` client-side after the rows come
    // back, so pairing it with skip/take would paginate the PRE-distinct rows and the rotation
    // window would silently resample the same users. groupBy becomes a real SQL GROUP BY, so
    // OFFSET/LIMIT apply to distinct users the way this rotation assumes.
    listCandidateUserIds: async (limit, offset) => {
      const rows = await db.league.groupBy({
        by: ['userId'],
        orderBy: { userId: 'asc' },
        skip: offset,
        take: limit,
      })
      return rows
        .map((r) => r.userId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    },
    countCandidates: async () => {
      const rows = await db.league.groupBy({ by: ['userId'] })
      return rows.length
    },
    computeSummary: (userId) => computeLineupActionsForUser(userId),
    runShadow: (userId, summary, opts) => runLineupShadowForSummary(userId, summary, opts),
    now: () => Date.now(),
  }
}

/**
 * Normalise a non-ran shadow result into a skip reason.
 *
 * `LineupShadowResult` has NO `skipReason` field -- the reason lives in `error`, set to
 * 'inputs_unavailable' or the caught exception's message. Reaching for a field that does not
 * exist would bucket every skip as 'unknown' and make this whole sweep useless as a diagnosis.
 */
function skipReasonOf(result: LineupShadowResult | undefined): string {
  const raw = typeof result?.error === 'string' ? result.error.trim() : ''
  if (!raw) return 'unknown'
  // Exception messages are unbounded and would shatter the tally into single-count buckets.
  return raw.length > 60 ? raw.slice(0, 60) : raw
}

/**
 * Sweep a rotating window of users, running the lineup shadow for each.
 *
 * NEVER THROWS. It is called from a cron that has other work to do, and a non-2xx here would make
 * a scheduled job look broken over a telemetry side-quest.
 */
export async function runLineupShadowSweep(
  deps: ShadowSweepDeps,
  opts: { batch?: number; budgetMs?: number; enabled?: boolean } = {},
): Promise<ShadowSweepResult> {
  const started = deps.now()
  const empty: ShadowSweepResult = {
    ran: false,
    usersConsidered: 0,
    usersSwept: 0,
    comparisons: 0,
    skips: 0,
    skipReasons: {},
    errors: 0,
    elapsedMs: 0,
    offset: 0,
  }
  if (opts.enabled === false) return { ...empty, reason: 'sweep_disabled' }

  const batch = Math.max(1, opts.batch ?? DEFAULT_BATCH)
  const budgetMs = Math.max(1_000, opts.budgetMs ?? DEFAULT_BUDGET_MS)
  const skipReasons: Record<string, number> = {}
  let comparisons = 0
  let skips = 0
  let errors = 0
  let usersSwept = 0
  let offset = 0
  let total = 0

  try {
    total = await deps.countCandidates()
    if (total === 0) return { ...empty, reason: 'no_candidates', elapsedMs: deps.now() - started }

    // Stateless rotation: each bucket advances the window by one batch, so the population is
    // covered over time without persisting a cursor. Modulo keeps the offset in range as the
    // population grows or shrinks.
    const bucket = Math.floor(deps.now() / ROTATION_BUCKET_MS)
    offset = (bucket * batch) % total

    const userIds = await deps.listCandidateUserIds(batch, offset)

    for (const userId of userIds) {
      if (deps.now() - started > budgetMs) break
      try {
        const summary = await deps.computeSummary(userId)
        if (!summary?.leagues?.length) {
          skips += 1
          skipReasons.no_leagues = (skipReasons.no_leagues ?? 0) + 1
          continue
        }
        // Rotate the LEAGUE too, not just the user. One production account owns 63 of the 69
        // leagues that have rosters; with a fixed slice the sweep re-measured that account's
        // first league on every tick and reached 4 leagues in total. The bucket already
        // advances the user window -- reusing it here advances the league window as well, at
        // no extra cost per tick.
        const results = await deps.runShadow(userId, summary, { maxLeagues: 1, leagueOffset: bucket })
        usersSwept += 1
        for (const r of results) {
          if (r?.ran) {
            comparisons += 1
          } else {
            skips += 1
            const reason = skipReasonOf(r)
            skipReasons[reason] = (skipReasons[reason] ?? 0) + 1
          }
        }
      } catch {
        // One user's failure must not abort the sweep: a single league with bad data would
        // otherwise permanently block every user ordered after it, and the rotation would keep
        // returning to it forever.
        errors += 1
      }
    }

    return {
      ran: true,
      usersConsidered: total,
      usersSwept,
      comparisons,
      skips,
      skipReasons,
      errors,
      elapsedMs: deps.now() - started,
      offset,
    }
  } catch (e) {
    return {
      ...empty,
      reason: e instanceof Error ? e.message.slice(0, 120) : 'sweep_failed',
      errors: errors + 1,
      elapsedMs: deps.now() - started,
      offset,
    }
  }
}
