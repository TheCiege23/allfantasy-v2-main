import 'server-only'

import { prisma as defaultPrisma } from '@/lib/prisma'
import { rotateForFairness, remainingFor, type RunBudget } from '@/lib/cron/runBudget'
import { runSeasonForecast } from './SeasonForecastEngine'

/**
 * THE SCHEDULED WRITER FOR `season_forecast_snapshots`, WHICH HAD NONE.
 *
 * ── 🛑 THE SECOND LINK OF THE SAME CHAIN ────────────────────────────────────────────────────
 * `rankingsSweep` fixed the bottom table. This is the one above it, and it had the SAME disease:
 * its only live writer is a membership-gated POST that nothing calls on a schedule.
 *
 *     rankings_snapshots            ✅ written on a schedule since 2026-09-12 05:00Z
 *           ↓ loadContext bails: `if (!snap.length) return null`
 *     season_forecast_snapshots     0 rows   ← THIS FILE
 *           ↓ assembleWindowFacts: `if (gaps.length) return { facts: null, … }`
 *     competitive window            refused for 288 of 288 leagues
 *
 * Censused at `a53e10649`, all four import forms with a positive control on every "no callers"
 * claim. `runSeasonForecast` has exactly ONE live caller —
 * `POST /api/leagues/[leagueId]/season-forecast`, behind `requireLeagueApiAccess`, reached through
 * the `[section]` dispatcher by DYNAMIC import (which is why the handler looks orphaned: there is
 * no `route.ts` in its directory). Zero crons and zero workflows mention it.
 *
 * ⚠ THE OTHER PATH LOOKS LIVE AND IS DEAD: `SeasonSimulator.runSeasonSimulation` →
 * `SimulationEngine.runSeason` → re-exported by `lib/simulation-engine/index.ts`. Nothing imports
 * `runSeason`. `warehouse-integration.persistForecastSnapshot`, a second direct upsert to the same
 * table, has zero importers at all.
 *
 * ── 🛑 WHY THIS IS NOT SHAPED LIKE `rankingsSweep`, DESPITE DOING THE SAME JOB ───────────────
 * That sweep is NETWORK bound — ~6 live Sleeper calls per league, ~1.4s warm median, and the batch
 * size is its rate limiter because `lib/sleeper-client.ts` has a 12s timeout and nothing else.
 *
 * This one makes NO external calls at all. It is CPU plus a handful of indexed Postgres reads, so
 * there is no rate-limit question here — only a "do not hog the worker's event loop" question.
 * Measured 2026-09-12 (11 trials, JIT warmed and discarded, no competing tsc, 2000 simulations and
 * both aggregation passes, 13 remaining weeks as production actually sits today):
 *
 *     12 teams   62ms        16 teams   76ms        20 teams   85ms
 *
 * ⚠ AN EARLIER RUN OF THE SAME MEASUREMENT SAID 74-224ms AND HAD 18 TEAMS SLOWER THAN 20 — an
 * impossible ordering, and the tell that it was noise rather than signal. A cap set on that run
 * would have been 3x too conservative. The numbers above are the re-measured ones.
 */

/** Off unless explicitly enabled. Landing this changes nothing until an operator flips it. */
export const FORECAST_SWEEP_FLAG = 'DECISION_OS_FORECAST_SWEEP_ENABLED'

export function forecastSweepEnabled(): boolean {
  return process.env[FORECAST_SWEEP_FLAG] === 'true'
}

/**
 * League-weeks forecast per fire.
 *
 * ⚠ SET BY THE PRODUCER, NOT BY THE COST. At ~62-85ms each this could do far more, and doing so
 * would be pointless: this sweep can only forecast a league-week that ALREADY has rankings, and
 * `rankingsSweep` produces 5 of those per fire. 10 drains a backlog at twice the rate it accrues
 * and then idles at whatever the producer supplies, which is the behaviour wanted — a cap of 50
 * would burn one fire clearing the backlog and every later fire would find nothing due.
 *
 * The cost at this cap is ~0.85s of CPU locally. ⚠ That is measured on a developer machine, NOT on
 * the worker container; assume 2-4x slower there, so ~2-3.5s against a fire that currently runs
 * ~14s inside a 240s budget.
 */
const DEFAULT_LEAGUE_CAP = 10

/** Matches the host cron's fire interval, so a different slice leads each fire. */
const ROTATION_PERIOD_MS = 30 * 60 * 1000

/**
 * Ceiling on ONE league-week's compute.
 *
 * 🛑 `budget.exhausted()` IS CHECKED BETWEEN UNITS AND CANNOT BOUND ONE — the same gap
 * `rankingsSweep` documents. 5s is ~50x the measured median, which is deliberate slack for a cold
 * container and a shared CPU rather than a prediction. `remainingFor` returns `null` when a unit
 * cannot possibly finish, so one that cannot complete is never started.
 */
const PER_UNIT_CAP_MS = 5_000

/**
 * The engine's own default, duplicated here ONLY to predict a decline before paying for it.
 *
 * 🛑 IT IS NOT PASSED IN, AND MUST NOT BE. `runSeasonForecast` defaults `totalWeeks` to 14 and
 * `getRemainingSchedule` returns `[]` once `currentWeek >= totalWeeks`, which makes the engine
 * return `null` having written nothing. Passing our own value would silently change forecasts for
 * every league; reading it lets us CLASSIFY the decline instead of filing it as a failure.
 */
const ENGINE_DEFAULT_TOTAL_WEEKS = 14

export interface ForecastSweepCounts {
  /** Distinct league-weeks that have rankings, before the per-fire cap. */
  considered: number
  /** Of those, the ones with no forecast row yet. */
  due: number
  /** Forecasts actually persisted. Read off the write path, never inferred. */
  written: number
  /**
   * League-weeks at or past the engine's `totalWeeks`, refused WITHOUT calling the engine.
   *
   * ⚠ THIS IS A PREDICTION, AND IT IS THE ONLY REASON THE COUNT BELOW MEANS ANYTHING. The engine
   * collapses "no rankings" and "no remaining schedule" into one bare `null`, so a caller cannot
   * tell them apart after the fact. Week >= totalWeeks is arithmetic we can do for free, so it is
   * separated here rather than landing in `declined` — otherwise late season, when EVERY league is
   * past week 14, would look identical to a broken engine.
   */
  pastSeasonEnd: number
  /**
   * The engine returned `null` for a reason we did not predict.
   *
   * 🛑 NOT SUCCESS. A `null` means nothing was written, and the whole reason this chain sat empty
   * for months is that a silent no-op read as a completed run.
   */
  declined: number
  /** Anything the named cases above do not cover. */
  failed: number
  /** Units not reached because the budget ran out. Reported, never silently dropped. */
  skippedForTime: number
  errors: string[]
}

export function emptyForecastSweepCounts(): ForecastSweepCounts {
  return { considered: 0, due: 0, written: 0, pastSeasonEnd: 0, declined: 0, failed: 0, skippedForTime: 0, errors: [] }
}

export interface ForecastSweepDeps {
  prisma?: typeof defaultPrisma
  budget: RunBudget
  leagueCap?: number
  now?: () => number
}

/** One unit of work: a league-week that has rankings. */
interface Unit {
  leagueId: string
  season: number
  week: number
}

/** `${leagueId}|${season}|${week}` — the shape of the table's own unique key. */
function keyOf(u: Unit): string {
  return `${u.leagueId}|${u.season}|${u.week}`
}

/**
 * Sweep league-weeks that have rankings but no forecast, writing one for each.
 *
 * Returns counts for every outcome. A fire that had work and wrote nothing is visible in the
 * numbers rather than reported as success.
 */
export async function runForecastSweep(deps: ForecastSweepDeps): Promise<ForecastSweepCounts> {
  const counts = emptyForecastSweepCounts()

  /*
   * ⚠ THE FLAG IS READ AT THE BOUNDARY, SO FLAG-OFF COSTS NOTHING — not one row read, not one
   * simulation. A flag that still paid for the work it disables would not be a flag.
   */
  if (!forecastSweepEnabled()) return counts

  const prisma = deps.prisma ?? defaultPrisma
  const now = deps.now ?? (() => Date.now())
  const leagueCap = Math.max(1, deps.leagueCap ?? DEFAULT_LEAGUE_CAP)

  /*
   * 🛑 DUE-NESS IS A SET DIFFERENCE, NOT A CLOCK TTL, AND THAT IS DELIBERATE.
   *
   * `SeasonForecastSnapshot.generatedAt` is `@default(now())` with no `@updatedAt`, and
   * `runSeasonForecast`'s upsert does not touch it on the update branch — the SAME defect
   * `saveRankingsSnapshot` carried, found while scoping this file and repaired separately. A TTL
   * read off `generatedAt` would inherit it here, so this does not read that column at all. Asking
   * "which league-weeks have rankings but no forecast" needs no timestamp at all, so it cannot
   * rot the same way, and a new week becomes due on its own the moment rankings appear for it.
   *
   * Two queries for the whole fire rather than one per league. Both tables are small and both
   * reads are covered by existing indexes.
   */
  let ranked: Array<{ leagueId: string; season: string; week: number }>
  let forecast: Array<{ leagueId: string; season: number; week: number }>
  try {
    ranked = await prisma.rankingsSnapshot.findMany({
      distinct: ['leagueId', 'season', 'week'],
      select: { leagueId: true, season: true, week: true },
    })
    forecast = await prisma.seasonForecastSnapshot.findMany({
      select: { leagueId: true, season: true, week: true },
    })
  } catch (e: unknown) {
    counts.errors.push(`due_query: ${e instanceof Error ? e.message : String(e)}`)
    counts.failed += 1
    return counts
  }

  /*
   * ⚠ THE TWO TABLES DISAGREE ABOUT THE TYPE OF `season`: `rankings_snapshots.season` is a String
   * and `season_forecast_snapshots.season` is an Int. Comparing them without converting would make
   * every key miss, so every league-week would look due forever and be rewritten on every fire —
   * a silent, expensive no-op. A season that will not parse is dropped rather than coerced to NaN.
   */
  const units: Unit[] = []
  for (const r of ranked) {
    const season = Number(r.season)
    if (!Number.isFinite(season)) continue
    units.push({ leagueId: r.leagueId, season, week: r.week })
  }

  const have = new Set(forecast.map((f) => keyOf({ leagueId: f.leagueId, season: f.season, week: f.week })))
  const dueUnits = units.filter((u) => !have.has(keyOf(u)))

  counts.considered = units.length
  counts.due = dueUnits.length
  if (dueUnits.length === 0) return counts

  const ordered = rotateForFairness(dueUnits, ROTATION_PERIOD_MS)
  let attempted = 0

  for (const unit of ordered) {
    if (attempted >= leagueCap) break

    // Checked BETWEEN units, per RunBudget's contract.
    if (deps.budget.exhausted()) {
      counts.skippedForTime = dueUnits.length - attempted
      break
    }
    // And the half `exhausted()` cannot do: refuse to START a unit that cannot finish.
    if (remainingFor(now() + deps.budget.remainingMs(), PER_UNIT_CAP_MS) === null) {
      counts.skippedForTime = dueUnits.length - attempted
      break
    }

    /*
     * Predicted decline, refused before paying for it. See `pastSeasonEnd` above for why this is
     * counted apart from `declined` rather than folded into it.
     */
    if (unit.week >= ENGINE_DEFAULT_TOTAL_WEEKS) {
      counts.pastSeasonEnd += 1
      attempted += 1
      continue
    }

    attempted += 1

    try {
      /*
       * ⚠ `season` AND `week` COME FROM THE RANKINGS ROWS, NEVER FROM A CLOCK.
       *
       * `runSeasonForecast` requires both and puts them straight into a WHERE against
       * `rankings_snapshots` — with NO `??` fallback anywhere. A guessed week therefore does not
       * write bad data, it writes NOTHING and returns `null`, which is indistinguishable from
       * "this league has no rankings". The rows we are iterating ARE the keys, so the guess is
       * structurally impossible here. (The sibling trap, where a guessed `0` DID write bad data
       * because `??` is nullish, is recorded in `rankingsSweep`.)
       */
      const result = await runSeasonForecast({
        leagueId: unit.leagueId,
        season: unit.season,
        week: unit.week,
      })

      if (!result) {
        counts.declined += 1
        continue
      }
      counts.written += 1
    } catch (e: unknown) {
      /*
       * Per-unit isolation: one league the engine throws on is one league's problem, and the walk
       * continues rather than abandoning the rest of the slice.
       */
      counts.failed += 1
      counts.errors.push(`${unit.leagueId} ${unit.season}w${unit.week}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return counts
}
