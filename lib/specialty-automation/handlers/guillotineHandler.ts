import { runElimination } from '@/lib/guillotine/GuillotineEliminationEngine'
import { IMPORTED_CHOP_REASON } from '@/lib/guillotine/importedLeagueGuard'
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
