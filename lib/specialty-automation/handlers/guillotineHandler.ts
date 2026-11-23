import { prisma } from '@/lib/prisma'
import { runElimination } from '@/lib/guillotine/GuillotineEliminationEngine'
import { runNativeGuillotineWeek } from '@/lib/guillotine/nativeGuillotineWeek'
import { syncPlayerWeeklyScoresForRedraftSeason } from '@/lib/redraft/playerWeeklyScoreService'
import { resolveSeasonWeekForRedraftSeason } from '@/lib/season-week'
import { IMPORTED_CHOP_REASON, isImportedLeague } from '@/lib/guillotine/importedLeagueGuard'
import { planEliminateRoster } from '@/lib/specialty-automation/actionPlans'
import type { HandlerContext, HandlerResult } from '@/lib/specialty-automation/types'

const ALLOWED: Set<string> = new Set(['onWeekFinalized', 'onManualRun', 'onScheduledPass', 'onStandingsUpdated'])

export async function runGuillotineHandler(ctx: HandlerContext): Promise<HandlerResult> {
  if (!ALLOWED.has(ctx.trigger)) {
    return {
      summary: 'Guilly automation skipped for this trigger.',
      actions: [],
      events: [],
      skipped: true,
      skipReason: 'trigger_not_applicable',
    }
  }

  const week = ctx.week
  if (week == null || week < 1) {
    return {
      summary: 'Guilly needs a valid week context.',
      actions: [],
      events: [],
      skipped: true,
      skipReason: 'missing_week',
    }
  }

  /*
   * 🛑 THE COMMISSIONER'S MANUAL RUN COULD NEVER CHOP. It called `runElimination` with no
   * `periodEndedAt`, and the week evaluator reads a missing end time as "before the stat correction
   * cutoff", so every run answered "no chop" however long ago the week ended. It also read stored
   * period scores that only the scheduled run writes. Only the five-minute score sync ever chopped.
   *
   * A league hosted here with a season now goes through the SAME driver the score sync uses
   * (`runNativeGuillotineWeek`): it seals the week, waits for the correction cutoff, scores the teams,
   * and chops under the same lock. A manual run is therefore the scheduled run, asked for now. It
   * skips nothing the scheduled run checks, and it says in words why a week is not ready.
   */
  // An imported league is chopped by its provider: the driver is never started for one.
  const native = (await isImportedLeague(ctx.leagueId)) ? null : await runNativeWeek(ctx.leagueId, ctx.season)
  if (native) return native

  const chop = await runElimination({
    leagueId: ctx.leagueId,
    weekOrPeriod: week,
    season: ctx.season,
    skipChat: true,
    skipRosterRelease: false,
  })

  if (chop?.reason === IMPORTED_CHOP_REASON) {
    return {
      summary: 'Guilly automation skipped: an imported league is chopped by its provider.',
      actions: [],
      events: [],
      skipped: true,
      skipReason: 'imported_league',
    }
  }

  if (!chop) {
    return {
      summary: 'No Guilly config or elimination not applicable.',
      actions: [{ actionType: 'guillotine_evaluate', metadata: { result: 'no_config' } }],
      events: [],
      skipped: true,
      skipReason: 'no_guillotine_config',
    }
  }

  const actions = []
  if (chop.choppedRosterIds.length > 0) {
    for (const rid of chop.choppedRosterIds) {
      actions.push(
        planEliminateRoster(rid, {
          weekOrPeriod: week,
          tiebreak: chop.tiebreakStepUsed,
          reason: chop.reason,
        }),
      )
    }
  }

  const events = []
  if (chop.choppedRosterIds.length > 0) {
    events.push({
      eventType: 'guillotine_chop',
      title: `Chop week ${week}`,
      description: `${chop.choppedRosterIds.length} team(s) eliminated.`,
      payload: {
        weekOrPeriod: week,
        choppedRosterIds: chop.choppedRosterIds,
        reason: chop.reason,
      },
    })
  }

  return {
    summary:
      chop.choppedRosterIds.length > 0
        ? `Guilly: ${chop.choppedRosterIds.length} chop(s). ${chop.reason ?? ''}`
        : `Guilly: no chop. ${chop.reason ?? ''}`,
    actions,
    events,
    phaseState: {
      currentPhase: 'elimination',
      currentStage: 'weekly_chop',
      currentWeekContext: week,
      metadata: { lastChopReason: chop.reason },
    },
  }
}

/** Why the driver is waiting, for the commissioner who pressed the button. */
export function describeGuillotineWait(reason: string | undefined, week: number | undefined): string {
  const w = week != null ? `Week ${week}` : 'The week'
  switch (reason) {
    case 'week_in_progress':
      return `${w} is still being played. The chop runs after its last game and the stat correction window.`
    case 'stat_correction_window':
      return `${w} is over. The chop waits for the stat correction window to close, so nobody is chopped on a score that changes.`
    case 'games_not_final':
      return `${w} still has a game that is not final.`
    case 'stat_coverage_below_floor':
    case 'game_stats_missing':
    case 'game_stats_missing_escalated':
      return `${w} is missing player stats for at least one game. Nobody is chopped on scores the stat feed has not sent.`
    case 'period_end_unknown':
      return `${w} has no stored schedule, so its end time is unknown.`
    default:
      return reason ? `${w} is not ready to chop (${reason.replace(/_/g, ' ')}).` : `${w} is not ready to chop.`
  }
}

async function runNativeWeek(leagueId: string, seasonYear: number | null | undefined): Promise<HandlerResult | null> {
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId, ...(seasonYear != null ? { season: seasonYear } : {}) },
    orderBy: { season: 'desc' },
    select: { id: true },
  })
  // No season (an imported league, or a league that has not drafted): the older call below answers.
  if (!season) return null
  const resolved = await resolveSeasonWeekForRedraftSeason(season.id)
  if (!resolved.ok || resolved.phase === 'preseason') {
    return { summary: 'Guilly: the season has not started, so there is no week to chop.', actions: [], events: [], skipped: true, skipReason: 'season_not_started' }
  }
  const run = await runNativeGuillotineWeek(
    { seasonId: season.id, currentFantasyWeek: resolved.fantasyWeek, currentWeekComplete: resolved.sportWeekComplete },
    {
      syncWeekStats: async ({ seasonId, week }) => {
        await syncPlayerWeeklyScoresForRedraftSeason({ seasonId, week, actorId: 'system:guillotine-manual-run' })
      },
    },
  )
  if (run.outcome === 'not_guillotine') return null
  const week = run.week ?? null
  const phaseState = { currentPhase: 'elimination', currentStage: 'weekly_chop', currentWeekContext: week, metadata: { lastChopOutcome: run.outcome, lastChopReason: run.reason ?? null } }
  if (run.outcome !== 'chopped') {
    const summary =
      run.outcome === 'waiting' ? `Guilly: no chop yet. ${describeGuillotineWait(run.reason, run.week)}`
        : run.outcome === 'already_chopped' ? `Guilly: week ${week} has already been chopped.`
          : run.outcome === 'no_chop' ? `Guilly: week ${week} is a no-chop week on this league's schedule.`
            : run.outcome === 'season_complete' ? 'Guilly: the season is finished.'
              : run.outcome === 'final_stage_scored' ? `Guilly: week ${week} of the final stage is scored. No team is chopped in the final stage.`
                : run.outcome === 'locked' ? 'Guilly: the chop is already running. Try again in a few minutes.'
                  : `Guilly: no chop. ${run.reason ?? run.outcome.replace(/_/g, ' ')}`
    return { summary, actions: [], events: [], phaseState, skipped: run.outcome === 'waiting' || run.outcome === 'locked', ...(run.outcome === 'waiting' || run.outcome === 'locked' ? { skipReason: run.reason ?? run.outcome } : {}) }
  }
  // The actions and the event name the league-page rosters the chop took, as the older call's did.
  const chopped = week != null
    ? await prisma.guillotineRosterState.findMany({ where: { leagueId, choppedInPeriod: week }, select: { rosterId: true } })
    : []
  const ids = chopped.map((c) => c.rosterId)
  return {
    summary: `Guilly: ${ids.length || (run.choppedRedraftRosterIds?.length ?? 0)} chop(s) in week ${week}.${run.reason ? ` ${run.reason}` : ''}`,
    actions: ids.map((rid) => planEliminateRoster(rid, { weekOrPeriod: week, reason: run.reason ?? null })),
    events: ids.length
      ? [{ eventType: 'guillotine_chop', title: `Chop week ${week}`, description: `${ids.length} team(s) eliminated.`, payload: { weekOrPeriod: week, choppedRosterIds: ids, reason: run.reason ?? null } }]
      : [],
    phaseState,
  }
}
