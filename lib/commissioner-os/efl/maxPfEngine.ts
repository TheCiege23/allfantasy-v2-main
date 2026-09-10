/**
 * TRUE Max PF — the maximum a roster COULD legally have scored, week by week.
 *
 * 🛑 THE BUSINESS DEFINITION, AND IT IS NOT WHAT THIS REPO HAS EVER MEANT BY THE NAME.
 * Max PF = the maximum legal fantasy points the roster could have scored in a regular-season
 * scoring period had the manager set the optimal legal lineup. It is explicitly NOT:
 * actual starting-lineup points, `LeagueTeam.pointsFor`, `SeasonResult.pointsFor`, or any running
 * total.
 *
 * **Benching a good player must not lower Max PF.** That is the entire purpose — the EFL
 * constitution uses Reverse Max PF to reduce tanking, and a metric you can lower by sitting your
 * best players rewards precisely the behaviour it exists to punish.
 *
 * ## The layering, and why it is two modules and not one
 *
 *   `lib/lineup-optimizer/optimalLineup.ts`  — WHICH players may sit in which seats. Sport- and
 *                                              league-agnostic, exact, provably optimal.
 *   this module                              — one week's rosters -> one value per team, then the
 *                                              season aggregate.
 *   `./maxPfFreeze.ts`                       — the week ceiling, the fingerprint, the state machine.
 *
 * Keeping the optimizer separate is what lets Best Ball adopt it later without inheriting anything
 * EFL-shaped, and lets this module be tested with hand-written rosters and no optimizer knowledge.
 *
 * ## Scoring is consumed, never recomputed
 *
 * ⚠ POINTS COME FROM `LeaguePlayerWeeklyScore.points`, WHICH IS SCORED BY THE SOURCE PLATFORM
 * UNDER THAT LEAGUE'S OWN SETTINGS. Its ingester's header is explicit that re-deriving them would
 * mean reproducing Sleeper's arithmetic including custom rules, and any mismatch shows a manager a
 * number their own platform disagrees with. So Max PF optimises SELECTION over canonical scores; it
 * does not contain a scoring engine and must never grow one.
 *
 * Pure: rosters and slots in, values out. No DB, no clock, no randomness.
 */

import {
  computeOptimalLineup,
  OPTIMAL_LINEUP_ALGORITHM,
  type LineupSlotSpec,
  type OptimalLineupResult,
  type OptimizerPlayerInput,
} from '@/lib/lineup-optimizer/optimalLineup'
import type { WeeklyTeamValue } from '@/lib/commissioner-os/efl/maxPfFreeze'

/**
 * The computation version, stamped onto every snapshot.
 *
 * 🛑 BUMP THIS WHENEVER THE NUMBER COULD MOVE — a change to the optimizer, to eligibility handling,
 * or to what counts as rostered. It is part of the freeze fingerprint AND part of the freeze's
 * uniqueness key, so a bump makes the old snapshot and the new one distinguishable rather than
 * silently comparable. Two engines producing "Max PF" that quietly disagree is the failure this
 * whole phase exists to end.
 */
export const MAX_PF_COMPUTATION_VERSION = `maxpf-optimal-v1+${OPTIMAL_LINEUP_ALGORITHM}`

/**
 * One player on one team in one week.
 *
 * ⚠ `wasStarter` IS CARRIED BUT NEVER USED BY THE OPTIMIZER. It exists so the engine can also report
 * what the manager ACTUALLY scored, which is the only way to show a commissioner the gap Max PF is
 * measuring. Feeding it into the selection would rebuild the bug this module replaces.
 */
export type WeeklyRosterPlayer = {
  playerId: string
  playerName?: string | null
  positions: readonly string[]
  points: number
  wasStarter: boolean
}

export type WeeklyTeamRoster = {
  teamId: string
  players: readonly WeeklyRosterPlayer[]
}

export type WeeklyMaxPfRow = {
  teamId: string
  week: number
  /** The optimal-lineup total. THE metric. */
  maxPf: number
  /**
   * What the submitted starting lineup actually scored, for explanation only.
   *
   * ⚠ NEVER THE METRIC, AND NEVER SUBSTITUTED FOR IT WHEN THE OPTIMIZER FINDS NOTHING. A week with
   * no eligible players has `maxPf: 0` and `actualStarterPoints: 0`; it does not fall back.
   */
  actualStarterPoints: number
  /** `maxPf - actualStarterPoints`. Zero when the manager set the optimal lineup. */
  pointsLeftOnBench: number
  optimal: OptimalLineupResult
}

export type WeeklyMaxPfResult = {
  week: number
  rows: WeeklyMaxPfRow[]
  /** Teams that appeared in `slotsForWeek` scope but had no rostered players that week. */
  teamsWithNoRoster: string[]
}

export type ComputeWeeklyMaxPfInput = {
  week: number
  /** The starting-lineup seats for THIS week. See `slotsForWeek` on the season input. */
  slots: readonly LineupSlotSpec[]
  teams: readonly WeeklyTeamRoster[]
}

/** One week: optimise every team's roster against that week's seats. */
export function computeWeeklyMaxPf(input: ComputeWeeklyMaxPfInput): WeeklyMaxPfResult {
  const rows: WeeklyMaxPfRow[] = []
  const teamsWithNoRoster: string[] = []

  /* Sorted so the result is a function of content, not of caller iteration order. */
  const teams = [...input.teams].sort((a, b) => (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0))

  for (const team of teams) {
    if (team.players.length === 0) {
      teamsWithNoRoster.push(team.teamId)
      continue
    }

    const players: OptimizerPlayerInput[] = team.players.map((p) => ({
      playerId: p.playerId,
      playerName: p.playerName ?? null,
      positions: p.positions,
      points: p.points,
    }))

    const optimal = computeOptimalLineup({ players, slots: input.slots })
    const actualStarterPoints =
      Math.round(team.players.filter((p) => p.wasStarter).reduce((s, p) => s + p.points, 0) * 100) / 100

    rows.push({
      teamId: team.teamId,
      week: input.week,
      maxPf: optimal.total,
      actualStarterPoints,
      pointsLeftOnBench: Math.round((optimal.total - actualStarterPoints) * 100) / 100,
      optimal,
    })
  }

  return { week: input.week, rows, teamsWithNoRoster: teamsWithNoRoster.sort() }
}

export type ComputeSeasonMaxPfInput = {
  regularSeasonFinalWeek: number
  /** Rosters per week. Weeks beyond the final week may be supplied; they are ignored. */
  weeks: readonly { week: number; teams: readonly WeeklyTeamRoster[] }[]
  /**
   * The seats for a given week.
   *
   * 🛑 A FUNCTION, NOT A SINGLE CONFIG, DELIBERATELY. Survivor All-Stars opens a WRT flex in week 7,
   * a SUPERFLEX in week 9 and two more flexes later — its Max PF is meaningless against a static
   * lineup. EFL does not change mid-season, so its reader returns the same seats for every week and
   * says so in provenance. The engine does not need to know which case it is in.
   *
   * ⚠ AND THIS REPO CANNOT RECONSTRUCT HISTORICAL SLOT CONFIGURATION — see
   * `./maxPfReads.ts`. The seam exists here so that the day it can, only the reader changes.
   */
  slotsForWeek: (week: number) => readonly LineupSlotSpec[]
}

export type ComputeSeasonMaxPfResult = {
  /** Per-team per-week values, ready for `computeRegularSeasonMaxPf`. */
  weeklyValues: WeeklyTeamValue[]
  weeks: WeeklyMaxPfResult[]
  /** Weeks 1..finalWeek for which no roster data was supplied at all. */
  weeksWithNoData: number[]
  computationVersion: string
}

/**
 * The season aggregate.
 *
 * 🛑 THE `week <= regularSeasonFinalWeek` FILTER IS APPLIED HERE *AND AGAIN* IN
 * `computeRegularSeasonMaxPf`. Deliberate redundancy: this one keeps the optimizer from doing
 * pointless work on playoff weeks, and that one is the GUARANTEE — it has to stay correct for any
 * caller that hands it unfiltered rows. Playoff points cannot reach the frozen number through
 * either path.
 */
export function computeSeasonMaxPf(input: ComputeSeasonMaxPfInput): ComputeSeasonMaxPfResult {
  const weeklyValues: WeeklyTeamValue[] = []
  const weeks: WeeklyMaxPfResult[] = []
  const seen = new Set<number>()

  const inScope = [...input.weeks]
    .filter((w) => Number.isInteger(w.week) && w.week >= 1 && w.week <= input.regularSeasonFinalWeek)
    .sort((a, b) => a.week - b.week)

  for (const w of inScope) {
    if (seen.has(w.week)) continue
    seen.add(w.week)
    const result = computeWeeklyMaxPf({
      week: w.week,
      slots: input.slotsForWeek(w.week),
      teams: w.teams,
    })
    weeks.push(result)
    for (const row of result.rows) {
      weeklyValues.push({ teamId: row.teamId, week: row.week, value: row.maxPf })
    }
  }

  const weeksWithNoData: number[] = []
  for (let w = 1; w <= input.regularSeasonFinalWeek; w += 1) if (!seen.has(w)) weeksWithNoData.push(w)

  return {
    weeklyValues,
    weeks,
    weeksWithNoData,
    computationVersion: MAX_PF_COMPUTATION_VERSION,
  }
}
