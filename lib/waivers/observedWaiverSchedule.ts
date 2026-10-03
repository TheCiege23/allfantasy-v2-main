import { Prisma, type PrismaClient } from '@prisma/client'

import { zonedParts, type WaiverSchedule } from '@/lib/core-app/waiverRunClock'

/**
 * A Sleeper league's waiver schedule, READ OFF WHEN ITS CLAIMS ACTUALLY PROCESSED.
 *
 * ── Why observed, not imported ──────────────────────────────────────────────────────────────
 * Sleeper's league settings carry `waiver_day_of_week` and `daily_waivers_hour`, now stored raw at
 * import (`sleeper_waiver_schedule`). What they MEAN is not established in this repo — the day
 * index's base, the hour's timezone (contracts/sleeper/GAPS.md S-05, S-06) — and the contract rule
 * is to record an unknown, not guess it. A wrong guess here is a countdown to the wrong day.
 *
 * Every completed waiver claim, though, carries Sleeper's `status_updated`: the instant it was
 * resolved. One league's claims in one run all resolve together, so its history clusters into
 * runs at the league's real processing time. That is a fact about the league, not a reading of
 * an enum, and it needs no extra provider call — the transaction sync already fetches it.
 *
 * ── What it refuses to say ──────────────────────────────────────────────────────────────────
 * - Fewer than MIN_RUNS agreeing runs → nothing. A schedule from one or two runs is a guess.
 * - Runs kept in PACIFIC wall-clock time. A fixed-UTC reading would count down to the wrong hour
 *   for months after each US daylight-saving change. If Sleeper's clock is not Pacific, the
 *   change splits the runs, agreement drops below the floor and this returns nothing until it
 *   re-forms — silence, never a confident wrong hour.
 * - Clock-free: it reads the most recent runs, never "the last N days", so the cross-league board
 *   can serve it from its cache (see waiversBoardSummary.ts).
 */

export const OBSERVED_TIME_ZONE = 'America/Los_Angeles'

/** Claims resolved within this many minutes of each other belong to one run. */
const RUN_GAP_MIN = 15
/** Runs considered — the most recent ones. */
const RUN_WINDOW = 10
/** Two runs this close in wall-clock time are "the same time". */
const TIME_TOLERANCE_MIN = 20
/** Agreeing runs needed before a schedule is shown at all. */
export const MIN_RUNS = 3

export type ObservedWaiverSchedule = {
  schedule: WaiverSchedule
  /** Runs that agree with the schedule, of the recent runs considered. */
  agreeingRuns: number
  consideredRuns: number
  /** ISO instant of the most recent run seen. */
  lastRunAt: string
}

export function deriveObservedWaiverSchedule(resolvedAtIso: readonly string[]): ObservedWaiverSchedule | null {
  const ms = [...new Set(resolvedAtIso)]
    .map((s) => Date.parse(s))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a)
  if (ms.length === 0) return null

  /*
   * Collapse claims into runs. Newest first, so a claim joins the current run when it is within
   * RUN_GAP_MIN of the claim before it (and the run spans under an hour). A run's time is its
   * EARLIEST resolution — when processing began.
   */
  const runs: number[] = []
  let runLatest = ms[0]
  let runEarliest = ms[0]
  for (let i = 1; i < ms.length; i++) {
    const chained = ms[i - 1] - ms[i] <= RUN_GAP_MIN * 60_000 && runLatest - ms[i] <= 60 * 60_000
    if (chained) {
      runEarliest = ms[i]
      continue
    }
    runs.push(runEarliest)
    runLatest = ms[i]
    runEarliest = ms[i]
  }
  runs.push(runEarliest)

  const recent = runs.slice(0, RUN_WINDOW).map((t) => {
    const p = zonedParts(t, OBSERVED_TIME_ZONE)
    return { t, dow: p.dow, minute: p.h * 60 + p.mi }
  })
  if (recent.length < MIN_RUNS) return null

  /* The wall-clock time most runs agree on (ties go to the more recent run). */
  let best: typeof recent = []
  for (const r of recent) {
    const agree = recent.filter((x) => Math.abs(x.minute - r.minute) <= TIME_TOLERANCE_MIN)
    if (agree.length > best.length) best = agree
  }
  if (best.length < MIN_RUNS) return null

  /*
   * Weekly or daily. A weekly league's main run lands on one weekday every week; a daily league's
   * runs spread across the week with no day dominating. Anything in between — a weekly league
   * whose waivers also clear on other days — is read as weekly on its busiest day, provided that
   * day alone has MIN_RUNS runs.
   */
  const byDow = new Map<number, number>()
  for (const r of best) byDow.set(r.dow, (byDow.get(r.dow) ?? 0) + 1)
  const [topDow, topCount] = [...byDow.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
  const daily = byDow.size >= 5 && topCount / best.length < 0.3

  const pool = daily ? best : best.filter((r) => r.dow === topDow)
  if (pool.length < MIN_RUNS) return null

  /* The earliest agreeing minute, floored to five: count down to when claims START resolving. */
  const minute = Math.floor(Math.min(...pool.map((r) => r.minute)) / 5) * 5
  const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

  return {
    schedule: { dayOfWeek: daily ? null : topDow, time, timeZone: OBSERVED_TIME_ZONE },
    agreeingRuns: pool.length,
    consideredRuns: recent.length,
    lastRunAt: new Date(recent[0].t).toISOString(),
  }
}

/** Resolution instants read per league — enough for RUN_WINDOW runs of a busy league. */
const CLAIMS_PER_LEAGUE = 400

/**
 * Observed schedules for many leagues in ONE read.
 *
 * ⚠ BY REAL LEAGUE, NOT BY AF ROW. One Sleeper league imported by two members is two AF rows, and
 * its transaction history attaches to whichever row the sync reached — so a twin can hold the
 * whole history while the other holds none. Every AF row of the same Sleeper league reads the
 * union, and each requested id gets the answer.
 */
export async function loadObservedWaiverSchedules(
  prisma: Pick<PrismaClient, 'league' | '$queryRaw'>,
  leagueIds: readonly string[],
): Promise<Map<string, ObservedWaiverSchedule>> {
  const out = new Map<string, ObservedWaiverSchedule>()
  const ids = [...new Set(leagueIds)].filter(Boolean)
  if (ids.length === 0) return out

  const asked = await prisma.league.findMany({
    where: { id: { in: ids }, platform: 'sleeper' },
    select: { id: true, platformLeagueId: true },
  })
  const keys = [...new Set(asked.map((l) => l.platformLeagueId).filter((k): k is string => !!k))]
  if (keys.length === 0) return out
  const twins = await prisma.league.findMany({
    where: { platform: 'sleeper', platformLeagueId: { in: keys } },
    select: { id: true, platformLeagueId: true },
  })
  const keyOf = new Map(twins.map((l) => [l.id, l.platformLeagueId as string]))
  const allIds = [...keyOf.keys()]

  const rows = await prisma.$queryRaw<Array<{ leagueId: string; resolvedAt: string }>>(Prisma.sql`
    SELECT "leagueId", "resolvedAt" FROM (
      SELECT "leagueId", payload->>'statusUpdatedAt' AS "resolvedAt",
             ROW_NUMBER() OVER (PARTITION BY "leagueId" ORDER BY payload->>'statusUpdatedAt' DESC) AS rn
      FROM "dw_transaction_facts"
      WHERE "leagueId" = ANY(${allIds}::text[])
        AND "type" = 'waiver'
        AND payload->>'statusUpdatedAt' IS NOT NULL
    ) x
    WHERE rn <= ${CLAIMS_PER_LEAGUE}
  `)

  const byKey = new Map<string, string[]>()
  for (const r of rows) {
    const k = keyOf.get(r.leagueId)
    if (!k || !r.resolvedAt) continue
    const list = byKey.get(k) ?? []
    list.push(r.resolvedAt)
    byKey.set(k, list)
  }
  const derived = new Map<string, ObservedWaiverSchedule | null>()
  for (const l of asked) {
    const k = l.platformLeagueId
    if (!k) continue
    if (!derived.has(k)) derived.set(k, deriveObservedWaiverSchedule(byKey.get(k) ?? []))
    const s = derived.get(k)
    if (s) out.set(l.id, s)
  }
  return out
}
