/**
 * The week roller: the caller `advance_week` never had.
 *
 * 🛑 `advance_week` HAS EXISTED, CORRECT AND GUARDED, WITH NO CALLER BUT A TEST.
 * `planCanonicalScheduleWeekTransition` refuses an incomplete week, rolls into
 * `regular_season_complete` at the end of the regular season, and auto-generates
 * the playoff bracket when it does. Nothing in the product invoked it: not a
 * cron, not a button — the only client reference to `/api/redraft/schedule` is a
 * GET. So every season in production sits at `currentWeek = 1` forever, and the
 * bracket generator that fires on `regular_season_complete` has never run.
 *
 * This module supplies the caller and nothing else. It deliberately adds no
 * guard of its own: the "every matchup finalized" rule already lives in the
 * schedule runtime and duplicating it here is the two-implementations bug. What
 * this decides is only *whether the real-world week is over*, which the schedule
 * runtime cannot know — and then it asks, and reports what it was told.
 */

import { prisma as defaultPrisma } from '@/lib/prisma'
import type { PrismaClient } from '@prisma/client'
import { advanceNflRedraftScheduleWeek } from '@/lib/schedule-runtime'
import {
  advanceNflRedraftPlayoffRuntimeRound,
  generateNflRedraftPlayoffRuntimeBracket,
} from '@/lib/playoff-runtime'
import { finalizeSeasonAndEnterOffseason } from '@/lib/redraft/offseason/finalizeSeasonAndEnterOffseason'
import { REDRAFT_SEASON_STATUS, engineSeasonScope } from '@/lib/redraft/seasonStatus'
import { resolveRegularSeasonEndWeek } from './leagueSeasonWeek'
import { resolveSeasonWeekForRedraftSeason } from './seasonWeekService'
import type { LeagueSeasonWeekResolution } from './types'

/** Why a season was left where it is. Every one is a normal outcome, not an error. */
export type WeekRollHoldReason =
  /** The sport has not kicked off, or the league starts later than the sport. */
  | 'PRESEASON'
  /** The resolver declined to name a week — unsupported sport, no schedule, bad data. */
  | 'WEEK_UNRESOLVED'
  /** The real-world slate for the league's current week is still being played. */
  | 'SLATE_IN_PROGRESS'
  /** The regular season is over; the playoff machine owns the league from here. */
  | 'REGULAR_SEASON_ENDED'
  /** The schedule runtime refused — most often because a matchup has not finalized. */
  | 'RUNTIME_REFUSED'

export type WeekRollPlan =
  | { action: 'advance'; fromWeek: number; toWeek: number }
  | { action: 'hold'; reason: WeekRollHoldReason; detail?: string }

export type PlanWeekRollInput = {
  resolution: LeagueSeasonWeekResolution
  /** `RedraftSeason.currentWeek` as stored. */
  currentWeek: number
  totalWeeks: number
  playoffStartWeek: number
  /** Which sport week the league's fantasy week 1 maps to. Defaults to 1. */
  anchorSportWeek?: number
}

/**
 * Decide whether a league's week is over, from the schedule alone.
 *
 * ⚠ ON THE SPORT-WEEK COMPARISON, AND A CLAIM THAT WAS RETRACTED HERE. This
 * comment first said comparing `fantasyWeek > currentWeek` instead "is right
 * only when the anchor is 1". That is false. Since
 * `fantasyWeek = sportWeek - anchor + 1` and `leagueSportWeek = currentWeek +
 * anchor - 1`, the two comparisons are algebraically the same expression; a
 * sweep of anchor 1-6 against weeks 1-20 finds zero cases where they disagree,
 * and the mutation swapping one for the other failed to turn a single test red —
 * which is how the wrong claim was caught.
 *
 * The sport-week form is kept for a smaller, true reason: `thisWeekFinished`
 * on the next line MUST compare sport weeks, so expressing both in the same
 * units keeps one unit inside one function.
 *
 * ⚠ The real hazard is a mismatch, not a formulation: `anchorSportWeek` here has
 * to be the same anchor that produced `resolution.fantasyWeek`, or the two halves
 * of this function are measuring different seasons. Today nothing passes one and
 * both default to 1, so it cannot bite yet — it will the moment a late-starting
 * league gets a stored anchor.
 */
export function planWeekRoll(input: PlanWeekRollInput): WeekRollPlan {
  const { resolution, currentWeek } = input

  if (!resolution.ok) {
    return { action: 'hold', reason: 'WEEK_UNRESOLVED', detail: resolution.reason }
  }
  if (resolution.phase === 'preseason') {
    return { action: 'hold', reason: 'PRESEASON' }
  }

  const regularSeasonEndWeek = resolveRegularSeasonEndWeek(input)
  if (currentWeek > regularSeasonEndWeek) {
    return { action: 'hold', reason: 'REGULAR_SEASON_ENDED' }
  }

  const anchor = Math.max(1, input.anchorSportWeek ?? 1)
  const leagueSportWeek = Math.max(1, currentWeek) + anchor - 1

  // The sport has moved past the league's week: that week is finished whatever
  // its own slate rows now say.
  const sportMovedOn = resolution.sportWeek > leagueSportWeek
  // Still on the league's week, and every game in it is played.
  const thisWeekFinished =
    resolution.sportWeek === leagueSportWeek && resolution.sportWeekComplete

  if (!sportMovedOn && !thisWeekFinished) {
    return { action: 'hold', reason: 'SLATE_IN_PROGRESS', detail: resolution.state }
  }

  return {
    action: 'advance',
    fromWeek: Math.max(1, currentWeek),
    // `advance_week` clamps to the regular-season length itself and flips the
    // season to `regular_season_complete` when it does; this is the expected
    // landing week, reported for the log rather than sent as an instruction.
    toWeek: Math.min(regularSeasonEndWeek, Math.max(1, currentWeek) + 1),
  }
}

export type SeasonRollOutcome = {
  seasonId: string
  leagueId: string
  sport: string
  currentWeek: number
  plan: WeekRollPlan
  /** Set only when an advance was attempted. */
  applied?: { ok: boolean; status?: string; currentWeek?: number; code?: string; message?: string }
}

export type WeekRollSummary = {
  considered: number
  advanced: number
  held: number
  failed: number
  outcomes: SeasonRollOutcome[]
}

export type RollSeasonWeeksOptions = {
  prisma?: PrismaClient
  now?: Date
  /** Cap per run, so one sweep cannot run unbounded as league count grows. */
  limit?: number
  /**
   * Decide and report without writing. The cron uses this for its first
   * production runs — a roller that has never been observed deciding should not
   * have its first observed act be a write.
   */
  dryRun?: boolean
  /** See `engineSeasonScope`; defaults to native leagues only. */
  includeShadowLeagues?: boolean
}

export async function rollSeasonWeeks(
  options: RollSeasonWeeksOptions = {},
): Promise<WeekRollSummary> {
  const db = options.prisma ?? defaultPrisma
  const now = options.now ?? new Date()

  const seasons = await db.redraftSeason.findMany({
    where: engineSeasonScope({ includeShadowLeagues: options.includeShadowLeagues }),
    select: {
      id: true,
      leagueId: true,
      sport: true,
      currentWeek: true,
      totalWeeks: true,
      playoffStartWeek: true,
    },
    take: options.limit ?? 200,
  })

  const outcomes: SeasonRollOutcome[] = []
  let advanced = 0
  let held = 0
  let failed = 0

  for (const season of seasons) {
    const resolution = await resolveSeasonWeekForRedraftSeason(season.id, { prisma: db, now })

    // `SEASON_NOT_FOUND` cannot happen here (we just read the row) but is part of
    // that function's union; fold it into the same hold rather than casting.
    const plan =
      'reason' in resolution && resolution.reason === 'SEASON_NOT_FOUND'
        ? ({ action: 'hold', reason: 'WEEK_UNRESOLVED', detail: 'SEASON_NOT_FOUND' } as WeekRollPlan)
        : planWeekRoll({
            resolution: resolution as LeagueSeasonWeekResolution,
            currentWeek: season.currentWeek,
            totalWeeks: season.totalWeeks,
            playoffStartWeek: season.playoffStartWeek,
          })

    if (plan.action === 'hold' || options.dryRun) {
      if (plan.action === 'hold') held += 1
      outcomes.push({ ...seasonFields(season), plan })
      continue
    }

    const applied = await advanceNflRedraftScheduleWeek({
      seasonId: season.id,
      action: 'advance_week',
      week: plan.fromWeek,
      actorUserId: WEEK_ROLLER_ACTOR,
      // Never override. The runtime's own refusal — an unfinalized matchup — is
      // exactly the case a human should look at, not one a scheduled job should
      // steamroll. It is reported as RUNTIME_REFUSED and left alone.
      commissionerOverride: false,
    })

    if (applied.ok) {
      advanced += 1
      outcomes.push({
        ...seasonFields(season),
        plan,
        applied: { ok: true, status: applied.status, currentWeek: applied.currentWeek },
      })
    } else {
      failed += 1
      outcomes.push({
        ...seasonFields(season),
        plan: { action: 'hold', reason: 'RUNTIME_REFUSED', detail: applied.code },
        applied: { ok: false, code: applied.code, message: applied.message },
      })
    }
  }

  return { considered: seasons.length, advanced, held, failed, outcomes }
}

/** Recorded on every audit row and event the advance emits. */
export const WEEK_ROLLER_ACTOR = 'system:week-roller'

function seasonFields(season: {
  id: string
  leagueId: string
  sport: string
  currentWeek: number
}): Pick<SeasonRollOutcome, 'seasonId' | 'leagueId' | 'sport' | 'currentWeek'> {
  return {
    seasonId: season.id,
    leagueId: season.leagueId,
    sport: season.sport,
    currentWeek: season.currentWeek,
  }
}


/* ------------------------------------------------------------------------- *
 * Postseason
 * ------------------------------------------------------------------------- */

export type PostseasonStep = 'generated_bracket' | 'advanced_round' | 'finalized' | 'held'

export type PostseasonOutcome = {
  seasonId: string
  leagueId: string
  status: string
  step: PostseasonStep
  detail?: string
  championRosterId?: string | null
  offseasonEntered?: boolean
}

export type PostseasonRollSummary = {
  considered: number
  generated: number
  advanced: number
  finalized: number
  held: number
  outcomes: PostseasonOutcome[]
}

/**
 * Carry a league through its own postseason.
 *
 * 🛑 EVERY STEP HERE ALREADY EXISTED AND WAS COMMISSIONER-MANUAL. Generate,
 * advance, finalize each have a real engine and a real button, and production
 * holds **zero playoff brackets** — because no league has ever reached the
 * regular-season boundary that starts the sequence. Automating the boundary
 * without automating what follows would move the dead end one step later.
 *
 * ⚠ IT ADDS NO GUARD OF ITS OWN, EXACTLY LIKE THE WEEK ROLLER.
 * `advanceNflRedraftPlayoffRound` already refuses with `MATCHUPS_INCOMPLETE` or
 * `TIE_UNRESOLVED` until every matchup in the active round has a winner, and
 * `finalize` refuses until the final round is done. Those refusals are the
 * safety; this reports them and moves on. A tie in particular MUST reach a
 * human — a scheduled job must never pick a winner.
 *
 * ⚠ ONE STEP PER SEASON PER RUN, DELIBERATELY. A loop that advanced every
 * available round in one pass would collapse a three-week postseason into one
 * tick the moment a bracket had stale scores. The cron runs hourly; a real
 * postseason has a week between rounds.
 */
export async function rollPostseason(
  options: RollSeasonWeeksOptions = {},
): Promise<PostseasonRollSummary> {
  const db = options.prisma ?? defaultPrisma

  const seasons = await db.redraftSeason.findMany({
    where: engineSeasonScope({
      includeShadowLeagues: options.includeShadowLeagues,
      statuses: [REDRAFT_SEASON_STATUS.REGULAR_SEASON_COMPLETE, REDRAFT_SEASON_STATUS.PLAYOFFS],
    }),
    select: { id: true, leagueId: true, status: true },
    take: options.limit ?? 200,
  })

  const outcomes: PostseasonOutcome[] = []
  let generated = 0
  let advanced = 0
  let finalized = 0
  let held = 0

  for (const season of seasons) {
    const base = { seasonId: season.id, leagueId: season.leagueId, status: season.status }

    if (options.dryRun) {
      held += 1
      outcomes.push({ ...base, step: 'held', detail: 'dryRun' })
      continue
    }

    // A season that reached `regular_season_complete` should already have a
    // bracket — `advanceNflRedraftScheduleWeek` generates one on that
    // transition. This is the repair path for a season that got there before
    // that existed, or whose generation failed.
    if (season.status === REDRAFT_SEASON_STATUS.REGULAR_SEASON_COMPLETE) {
      // ⚠ THIS GENERATOR THROWS; IT DOES NOT RETURN A RESULT UNION. Unlike
      // `advance` and `finalize` next to it, it either produces a bracket or
      // raises — a difference that is invisible at the call site and was written
      // wrong here first (`bracket.ok` on a value with no `ok`). The typecheck
      // caught it; the shapes are genuinely inconsistent, so the catch is the
      // whole error path rather than a fallback for one.
      try {
        await generateNflRedraftPlayoffRuntimeBracket({
          seasonId: season.id,
          actorUserId: WEEK_ROLLER_ACTOR,
        })
        generated += 1
        outcomes.push({ ...base, step: 'generated_bracket' })
      } catch (error) {
        held += 1
        outcomes.push({ ...base, step: 'held', detail: messageOf(error) })
      }
      continue
    }

    try {
      const round = await advanceNflRedraftPlayoffRuntimeRound({
        seasonId: season.id,
        actorUserId: WEEK_ROLLER_ACTOR,
      })

      if (round.ok) {
        advanced += 1
        outcomes.push({ ...base, step: 'advanced_round' })
        continue
      }

      // The final round is done and there is nothing left to advance: that is
      // the season ending, not a failure. Finalizing runs the whole extracted
      // chain — champion, archive, offseason, keeper window.
      if (round.code === 'NO_ACTIVE_ROUND') {
        const outcome = await finalizeSeasonAndEnterOffseason({
          seasonId: season.id,
          leagueId: season.leagueId,
          actorUserId: WEEK_ROLLER_ACTOR,
        })
        if (outcome.ok) {
          finalized += 1
          outcomes.push({
            ...base,
            step: 'finalized',
            championRosterId: outcome.championRosterId,
            offseasonEntered: outcome.offseasonEntered,
          })
        } else {
          held += 1
          outcomes.push({ ...base, step: 'held', detail: outcome.code })
        }
        continue
      }

      // MATCHUPS_INCOMPLETE, TIE_UNRESOLVED — both mean "a human, or more
      // scoring, is needed". Reported, never overridden.
      held += 1
      outcomes.push({ ...base, step: 'held', detail: round.code })
    } catch (error) {
      held += 1
      outcomes.push({ ...base, step: 'held', detail: messageOf(error) })
    }
  }

  return { considered: seasons.length, generated, advanced, finalized, held, outcomes }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
