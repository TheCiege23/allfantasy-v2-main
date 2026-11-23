/**
 * MY TEAM'S BENCH CHECK, GRADED IN BASKETBALL, HOCKEY AND BASEBALL (2026-11-23) — the pure half.
 *
 * Since 2026-11-23 an NBA, NHL or MLB weekly-points league's swap is recorded under the week My Team priced it for, on
 * that sport's own calendar (`benchCheckLedger.ts`). This grades those calls the way the NFL record grades its own
 * (`ledgerRecord.ts`): right, wrong, or the same within LEDGER_SAME_BAND, once the period is over — but each sport on
 * its own clock and into its own line, never into the NFL record.
 *
 * WHAT "WHAT HAPPENED" IS. Each player's points for the period are his stored game lines (`player_game_stats`, the
 * games dated inside the period's window) normalised and scored under THE LEAGUE'S OWN SCORING
 * (`buildLeagueStatScorer`) — the same pipeline the weekly matchup score uses (`playerWeeklyScoreService.ts`). Not the
 * feed's own fantasy points. ⚠ What it does NOT model: a games-limits or games-count rule (only some games count). The
 * comparison is every game he played that week, which is also what the weekly projection the call was made on prices.
 *
 * WHEN A PERIOD IS OVER: its window has closed AND the sport's schedule (`SportsGame`) holds a game in it whose start
 * is more than PERIOD_SETTLE_HOURS ago. A window with no scheduled game cannot be proven over: it is pending for a
 * week past its end, then unscored. Never the NFL calendar.
 *
 * A player with no stored game line in the period is UNSCORED, not zero: a missing line and a night off look the same
 * in the table, and the call must never be graded on a number nobody measured.
 *
 * Pure: no IO. `sportBenchGrading.ts` reads the rows and hands them here.
 */

import { gradeStartSit, type BenchTally, type StartSitCall } from './ledgerRecord'
import { foldBenchShareBands, type BenchEdgeLedger, type GradedShareBenchCall } from '@/lib/decision-os/lineup/benchCalibration'

/** The sports graded this way — the ones the ledger records on their own calendar. */
export const SPORT_BENCH_SPORTS = ['NBA', 'NHL', 'MLB'] as const
export type SportBenchSport = (typeof SPORT_BENCH_SPORTS)[number]

/** A period's last game must have started this long ago: stat corrections and late lines settle first. */
export const PERIOD_SETTLE_HOURS = 12
/** A window that ended this long ago with no scheduled game in it is unscored rather than pending forever. */
export const NO_SCHEDULE_GIVE_UP_DAYS = 7

export type SportPeriod = {
  /** The period's date window (`resolveDailySportWeekWindow`); null when the sport's calendar cannot place it. */
  window: { start: Date; end: Date } | null
  /** The latest scheduled start inside the window; null when the schedule holds none. */
  lastStart: Date | null
}

export type SportPeriodState = 'over' | 'pending' | 'unplaceable'

export function sportPeriodState(period: SportPeriod | null | undefined, now: Date): SportPeriodState {
  if (!period?.window) return 'unplaceable'
  const t = now.getTime()
  if (t < period.window.end.getTime()) return 'pending'
  if (!period.lastStart) {
    return t >= period.window.end.getTime() + NO_SCHEDULE_GIVE_UP_DAYS * 86_400_000 ? 'unplaceable' : 'pending'
  }
  return t >= period.lastStart.getTime() + PERIOD_SETTLE_HOURS * 3_600_000 ? 'over' : 'pending'
}

export type SportBenchCall = {
  withdrawn: boolean
  state: SportPeriodState
  /** Points under the league's scoring for the period; null = no stored line, or the league has no scorer. */
  recPts: number | null
  altPts: number | null
  /** What the call knew: both projections when it was made, and when. */
  recProjected?: number | null
  altProjected?: number | null
  givenAt?: Date | string | null
}

export type GradedSportBenchCall = { call: StartSitCall; recProjected: number | null; altProjected: number | null; ageDays: number }

/**
 * One sport's line: the tally and the bench check's own calibration for that sport — its graded calls that carried
 * both projections, banded by the edge's share of the starter's projection (`benchCalibration.ts`). `edges` is absent
 * when no such call was graded.
 */
export type SportBenchLine = { tally: BenchTally; edges?: BenchEdgeLedger }

/** The graded calls → the snapshot's line for the sport. A call missing either projection is tallied, never banded. */
export function sportBenchLineFrom(result: { tally: BenchTally; graded: readonly GradedSportBenchCall[] }): SportBenchLine {
  const banded: GradedShareBenchCall[] = result.graded.flatMap((g) =>
    g.recProjected != null && g.altProjected != null
      ? [{ edge: g.recProjected - g.altProjected, starterProjected: g.altProjected, call: g.call, ageDays: g.ageDays }]
      : [],
  )
  const edges = banded.length > 0 ? foldBenchShareBands(banded) : null
  return { tally: result.tally, ...(edges && Object.keys(edges).length > 0 ? { edges } : {}) }
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function gradeSportBenchCalls(calls: readonly SportBenchCall[], now: Date): { tally: BenchTally; graded: GradedSportBenchCall[] } {
  const tally: BenchTally = { right: 0, wrong: 0, same: 0, gain: 0, pending: 0, unscored: 0, withdrawn: 0 }
  const graded: GradedSportBenchCall[] = []
  for (const c of calls) {
    if (c.withdrawn) {
      tally.withdrawn++
      continue
    }
    if (c.state === 'pending') {
      tally.pending++
      continue
    }
    if (c.state !== 'over' || c.recPts == null || c.altPts == null || !Number.isFinite(c.recPts) || !Number.isFinite(c.altPts)) {
      tally.unscored++
      continue
    }
    const call = gradeStartSit(c.recPts, c.altPts)
    tally[call]++
    tally.gain += c.recPts - c.altPts
    const given = c.givenAt == null ? NaN : new Date(c.givenAt).getTime()
    graded.push({
      call,
      recProjected: typeof c.recProjected === 'number' && Number.isFinite(c.recProjected) ? c.recProjected : null,
      altProjected: typeof c.altProjected === 'number' && Number.isFinite(c.altProjected) ? c.altProjected : null,
      ageDays: Number.isFinite(given) ? Math.max(0, (now.getTime() - given) / 86_400_000) : 0,
    })
  }
  tally.gain = round1(tally.gain)
  return { tally, graded }
}
