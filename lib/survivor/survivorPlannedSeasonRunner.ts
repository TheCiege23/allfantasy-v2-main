import 'server-only'

import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { dailySportWeekForInstant } from '@/lib/season-week/dailySportSeasonStarts'
import { rotatingBatch } from '@/lib/redraft/scoreSyncBatch'
import { readSurvivorFullSeasonPlan, type SurvivorFullSeasonPlan } from './survivorFullSeasonPlan'
import {
  advancePhase, advanceWeek, allScoresFinalizedForWeek, finalizeWeeklyScores,
  getOrCreateSurvivorGameState, processTribalDeadline, syncWeeklyScores,
  triggerTribalOpen, tryAutomaticPhaseAdvance,
} from './gameStateMachine'
import { processReturnFromExile, scoreExileWeek } from './exileEngine'
import { getFinaleState, settleFinaleIfDue } from './SurvivorFinaleEngine'
import { ensureJuryVotingOpen } from './juryEngine'
import { nextTorchCeremonyDeadline } from './survivorCeremonySchedule'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'
import { closeExpiredExileRosters, finalizeExileRosterResults } from './exileRosterService'
import { ensureVerifiedSlateChallenges, settleVerifiedSlateChallenges } from './survivorVerifiedSlateChallenges'
import { generateAndPostWeeklyRecap } from './weeklyRecapGenerator'
import { settleNbaTribeSitOutDeadline } from './SurvivorSitOutEngine'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { notifySurvivorCommissionerOnce, SURVIVOR_JURY_OVERDUE_MS, SURVIVOR_SCORES_OVERDUE_MS } from './survivorCommissionerAlerts'

export type PlannedWeekKind = 'opening' | 'elimination' | 'rest' | 'finale' | 'outside'

export function plannedWeekKind(plan: SurvivorFullSeasonPlan, week: number): PlannedWeekKind {
  if (week < plan.startWeek || week > plan.endWeek) return 'outside'
  if (week === plan.openingWeek) return 'opening'
  if (week === plan.finaleWeek) return 'finale'
  return plan.eliminationWeeks.includes(week) ? 'elimination' : 'rest'
}

/** One bounded, retryable step. Every irreversible action has its own persisted gate. */
export async function runPlannedSurvivorLeague(leagueId: string, now = new Date()): Promise<string> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, sport: true, season: true, settings: true, survivorMode: true } })
  const plan = readSurvivorFullSeasonPlan(league?.settings)
  if (!league?.survivorMode || !isNativePlatform(league.platform) || !plan || league.sport !== plan.sport || league.season !== plan.season) return 'not_planned'
  const game = await getOrCreateSurvivorGameState(leagueId)
  if (game.pausedSnapshot != null) return 'paused'
  if (['pre_draft', 'drafting', 'complete', 'paused'].includes(game.phase)) return game.phase
  // The commissioner's pause writes pausedSnapshot and leaves phase alone.
  if (game.pausedSnapshot != null) return 'paused'
  const calendarWeek = dailySportWeekForInstant(plan.sport, plan.season, now)
  if (!calendarWeek || calendarWeek < plan.startWeek) return 'awaiting_opening'

  if (game.currentWeek < plan.startWeek) {
    await advanceWeek(leagueId)
    return 'opening_started'
  }
  const week = game.currentWeek
  if (week > plan.endWeek || week > calendarWeek) return 'awaiting_calendar'
  const kind = plannedWeekKind(plan, week)
  if (kind === 'outside') return 'outside_plan'
  const participation = await settleNbaTribeSitOutDeadline(leagueId, week, now)
  if (participation === 'blocked') return 'awaiting_tribe_rebalance'
  if (participation === 'awaiting_schedule' || participation === 'before_deadline') return 'awaiting_tribe_sit_out_lock'
  await ensureVerifiedSlateChallenges(leagueId, week, plan.sport, ['pre_merge', 'post_swap'].includes(game.phase))

  // Finalized player rows only exist after the common NBA/NHL slate, window,
  // grace and coverage checks. A missing or late feed simply keeps this pending.
  if (!game.weekScoringFinalAt) {
    if (!await allScoresFinalizedForWeek(leagueId, week)) {
      // The week has rolled over on the calendar and the feed is still not final: a person has to
      // look at the provider. Once per week, after a six-hour grace.
      const window = resolveDailySportWeekWindow(plan.sport, plan.season, week)
      if (window && calendarWeek > week && now.getTime() - window.end.getTime() > SURVIVOR_SCORES_OVERDUE_MS) {
        await notifySurvivorCommissionerOnce(leagueId, 'scores_overdue', {
          dedupeKey: String(week), week,
          title: `Week ${week} scores are overdue`,
          body: `Week ${week} ended but its verified scores are still not final, so the island is waiting. Check the stat feed; the season continues on its own once the scores arrive.`,
          deepLinkPath: `/survivor/${leagueId}`,
        }).catch(() => {})
      }
      return 'awaiting_verified_scores'
    }
    await syncWeeklyScores(leagueId, week)
    await finalizeWeeklyScores(leagueId, week)
    return 'scores_finalized'
  }
  await settleVerifiedSlateChallenges(leagueId, week)

  if (kind === 'elimination') {
    if (game.activeCouncilId) {
      if (!game.tribalDeadline || game.tribalDeadline > now) return 'voting_open'
      await processTribalDeadline(leagueId)
      return 'ceremony_processed'
    }
    const resolved = await prisma.survivorAuditEntry.findFirst({ where: { leagueId, week, action: { in: ['player_eliminated', 'planned_elimination_skipped_final_three'] } }, select: { id: true } })
    if (!resolved) {
      // The plan reserves one extra elimination for an Exile return. When
      // nobody qualifies, three finalists arrive a period early; never vote
      // out a fourth manager just to satisfy the static schedule.
      const active = await prisma.survivorPlayer.count({ where: { leagueId, playerState: 'active' } })
      if (active === 3) {
        await withSurvivorSetupTransaction(leagueId, async tx => {
          const existing = await tx.survivorAuditEntry.findFirst({ where: { leagueId, week, action: { in: ['player_eliminated', 'planned_elimination_skipped_final_three'] } }, select: { id: true } })
          if (existing || await tx.survivorPlayer.count({ where: { leagueId, playerState: 'active' } }) !== 3) return
          await tx.survivorAuditEntry.create({ data: { leagueId, week, category: 'automation', action: 'planned_elimination_skipped_final_three', data: { reason: 'final_three_reached' }, isVisibleToPublic: true, isVisibleToCommissioner: true } })
          await tx.survivorGameState.update({ where: { leagueId }, data: { needsTribalLock: false } })
        })
        return 'final_three_preserved'
      }
      if (active < 3) return 'cast_below_final_three'
      await tryAutomaticPhaseAdvance(leagueId)
      await triggerTribalOpen(leagueId)
      return 'council_opened'
    }
  }

  // A manual reveal must finish before any recap or next-week transition can
  // publish the outcome. This also keeps a playing commissioner blind.
  const councilForRead = await prisma.survivorTribalCouncil.findFirst({
    where: { leagueId, week },
    orderBy: { councilNumber: 'desc' },
    select: { isRevealed: true },
  })
  if (councilForRead && !councilForRead.isRevealed) return 'awaiting_reveal'

  const exileEntry = await prisma.exileWeeklyEntry.findFirst({ where: { leagueId, week }, select: { id: true } })
  if (exileEntry) {
    await closeExpiredExileRosters(leagueId, now)
    if (!await finalizeExileRosterResults(leagueId, week)) return 'awaiting_exile_results'
    if (!await scoreExileWeek(leagueId, week)) return 'awaiting_exile_results'
  }

  // The one return spot is awarded from the sealed deadline snapshot, after
  // this week's council has completed and never from the live token balance.
  if (plan.exileReturnWeek === week) {
    const settled = await prisma.survivorAuditEntry.findFirst({ where: { leagueId, action: 'scheduled_exile_return_resolved' }, select: { id: true } })
    if (!settled) {
      await processReturnFromExile(leagueId, { week })
      const after = await prisma.survivorAuditEntry.findFirst({ where: { leagueId, action: 'scheduled_exile_return_resolved' }, select: { id: true } })
      return after ? 'exile_return_settled' : 'awaiting_exile_results'
    }
  }

  await tryAutomaticPhaseAdvance(leagueId)
  if (kind === 'finale') {
    let finale = await getFinaleState(leagueId, week)
    if (finale.open && !finale.closed) {
      // Nobody has to click "open voting": the jury votes until the ceremony, and the engine
      // crowns the winner itself once every juror has voted or that deadline passes.
      if (!finale.votingDeadline) await ensureJuryVotingOpen(leagueId, nextTorchCeremonyDeadline(now, league.settings))
      finale = await settleFinaleIfDue(leagueId, week)
    }
    if (finale.closed && finale.winnerRosterId) {
      await generateAndPostWeeklyRecap(leagueId, week)
      await advancePhase(leagueId, 'automatic', undefined, { toPhase: 'complete', notes: 'jury_winner_revealed' })
      return 'season_complete'
    }
    if (finale.votingDeadline && now.getTime() - new Date(finale.votingDeadline).getTime() > SURVIVOR_JURY_OVERDUE_MS) {
      await notifySurvivorCommissionerOnce(leagueId, 'jury_overdue', {
        dedupeKey: new Date(finale.votingDeadline).toISOString(), week,
        title: 'The jury vote did not produce a champion',
        body: 'The jury deadline passed a day ago and no winner could be crowned. Open the finale controls to review the jury.',
        deepLinkPath: `/survivor/${leagueId}/jury`, urgency: 'critical',
      }).catch(() => {})
    }
    return 'awaiting_jury'
  }
  if (calendarWeek <= week) return 'awaiting_next_week'
  await generateAndPostWeeklyRecap(leagueId, week)
  await advanceWeek(leagueId)
  return 'week_advanced'
}

/** Runs inside the existing score-sync cron slot; never allocates a new slot. */
export async function runPlannedSurvivorSeasonBatch(now = new Date()) {
  // Creation and scoring can ship safely while the persisted season replay,
  // tie resolution and sport-specific challenge settlement finish validation.
  if (process.env.SURVIVOR_PLANNED_SEASON_AUTOMATION_ENABLED !== 'true') {
    return { considered: 0, failed: 0, outcomes: { disabled: 1 } }
  }
  const leagues = await prisma.league.findMany({ where: { survivorMode: true, sport: { in: ['NBA', 'NHL'] } }, select: { id: true, settings: true }, orderBy: { id: 'asc' } })
  const planned = leagues.filter(league => readSurvivorFullSeasonPlan(league.settings))
  const outcomes: Record<string, number> = {}
  let failed = 0
  for (const league of rotatingBatch(planned, 4, now.getTime())) {
    try {
      const outcome = await runPlannedSurvivorLeague(league.id, now)
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
    } catch (error) {
      failed++
      const message = error instanceof Error ? error.message : String(error)
      await prisma.survivorGameState.updateMany({ where: { leagueId: league.id }, data: { lastError: message } }).catch(() => {})
      // The dashboard shows lastError, but nobody opens the dashboard to find out. Once a day.
      await notifySurvivorCommissionerOnce(league.id, 'automation_error', {
        dedupeKey: now.toISOString().slice(0, 10),
        title: 'Survivor automation hit an error',
        body: `The season runner stopped on: ${message.slice(0, 200)}. It retries every few minutes; if this keeps failing, open the Commissioner Hub.`,
        deepLinkPath: `/league/${league.id}?guide=settings`, urgency: 'critical',
      }).catch(() => {})
    }
  }
  return { considered: Math.min(planned.length, 4), failed, outcomes }
}
