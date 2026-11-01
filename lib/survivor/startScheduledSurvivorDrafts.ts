import 'server-only'

import { prisma } from '@/lib/prisma'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getDraftPoolReadiness, triggerDraftPoolPrewarmBackground } from '@/lib/draft-room/ensureDraftPoolReady'
import { withControlLock } from '@/lib/draft/draftLock'
import { startDraftSession } from '@/lib/live-draft-engine/DraftSessionService'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { enqueueNotification } from './notificationEngine'
import {
  holdGuillotineScheduledDraft,
  loadGuillotineSeatState,
  planGuillotineScheduledDraft,
  prepareGuillotineSeatsForStart,
} from '@/lib/guillotine/lateStartSeats'
import { getSurvivorDraftStartReadiness } from './survivorDraftStartReadiness'
import { notifySurvivorCommissionerOnce, SURVIVOR_SEATS_ALERT_LEAD_MS } from './survivorCommissionerAlerts'
import { reportSurvivorAutomationError } from './survivorAutomationReporting'

export interface ScheduledSurvivorDraftSummary {
  scanned: number
  started: number
  skipped: number
  /** Native guillotine drafts that were not full and moved a week. */
  rolled?: number
  errors: Array<{ leagueId: string; error: string }>
}

/**
 * Called by the minute draft tick; native Survivor and Guillotine leagues that opted into autostart
 * qualify. Guillotine saved the "Autostart Draft" toggle but nothing read it, so the commissioner had
 * to press Start by hand at draft time.
 *
 * A native guillotine league starts only when it is full at the seat count its remaining chop weeks
 * support; otherwise the draft moves a week (see `lib/guillotine/lateStartSeats.ts`). Before that
 * rule it started on time with every open seat drafted by the CPU.
 */
export async function startScheduledSurvivorDrafts(now: Date = new Date()): Promise<ScheduledSurvivorDraftSummary> {
  const due = await prisma.leagueSettings.findMany({
    where: {
      autostart: true,
      draftDateUtc: { lte: now, gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
      league: { is: { OR: [{ survivorMode: true }, { guillotineMode: true }, { leagueVariant: 'guillotine' }] } },
    },
    select: { leagueId: true, league: { select: { platform: true } } },
    orderBy: { draftDateUtc: 'asc' },
    take: 100,
  })
  const summary: ScheduledSurvivorDraftSummary = { scanned: due.length, started: 0, skipped: 0, errors: [] }
  for (const { leagueId, league } of due) {
    try {
      if (resolveWriteAuthority(league.platform) !== 'NATIVE') {
        summary.skipped++
        continue
      }
      const session = await prisma.draftSession.findFirst({
        where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER,
        select: { status: true, sessionKind: true, sleeperDraftId: true },
      })
      if (!session || session.status !== 'pre_draft' || session.sessionKind === 'mock' || session.sleeperDraftId) {
        summary.skipped++
        continue
      }
      // Native guillotine: start only when every seat the remaining season can chop is claimed.
      // Not full -> the draft waits a week with fewer seats (lib/guillotine/lateStartSeats.ts).
      const seatState = await loadGuillotineSeatState(leagueId)
      const seatPlan = seatState ? await planGuillotineScheduledDraft(seatState) : null
      if (seatState && seatPlan && seatPlan.action !== 'start') {
        const held = await withControlLock(leagueId, () => holdGuillotineScheduledDraft(seatState, seatPlan))
        if (held.acquired && held.value === 'rolled') summary.rolled = (summary.rolled ?? 0) + 1
        summary.skipped++
        continue
      }
      const pool = await getDraftPoolReadiness(leagueId)
      if (!pool.ready) {
        triggerDraftPoolPrewarmBackground(leagueId)
        summary.skipped++
        continue
      }
      const locked = await withControlLock(leagueId, async () => {
        const current = await prisma.draftSession.findFirst({
          where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER,
          select: { status: true, sessionKind: true, sleeperDraftId: true },
        })
        if (!current || current.status !== 'pre_draft' || current.sessionKind === 'mock' || current.sleeperDraftId) return null
        if (seatState && seatPlan?.action === 'start') {
          const seats = await prepareGuillotineSeatsForStart(seatState, seatPlan)
          if (seats && !seats.ok) return { ok: false as const, reason: 'GUILLOTINE_SEATS' as const, error: `guillotine seats not reduced: ${seats.reason}` }
        }
        return startDraftSession(leagueId)
      })
      if (!locked.acquired || !locked.value) {
        summary.skipped++
      } else if (locked.value.ok) {
        summary.started++
        // A manual start notifies from the controls route; a scheduled one has no caller to do it.
      } else if (locked.value.reason === 'SURVIVOR_CAST_INCOMPLETE') {
        // A commissioner can claim the remaining seats and the next tick retries.
        summary.skipped++
        await noticeCastIncompleteOnce(leagueId, locked.value.error).catch(() => {})
      } else {
        const failure = locked.value.error ?? locked.value.reason
        summary.errors.push({ leagueId, error: failure })
        reportSurvivorAutomationError(new Error(`Scheduled Survivor draft did not start: ${failure}`), { job: 'draft_start', leagueId })
      }
    } catch (error) {
      summary.errors.push({ leagueId, error: error instanceof Error ? error.message : String(error) })
      reportSurvivorAutomationError(error, { job: 'draft_start', leagueId })
    }
  }
  // After the due drafts: a seat warning for tomorrow's drafts never delays today's start.
  await warnUnclaimedSeatsBeforeDraft(now).catch(() => {})
  return summary
}

/**
 * A day before a scheduled native Survivor draft, tell the commissioner about any seat that would
 * stop it from starting, while there is still time to fill or release it. Once per draft time.
 */
export async function warnUnclaimedSeatsBeforeDraft(now: Date = new Date()): Promise<number> {
  const upcoming = await prisma.leagueSettings.findMany({
    where: {
      autostart: true,
      draftDateUtc: { gt: now, lte: new Date(now.getTime() + SURVIVOR_SEATS_ALERT_LEAD_MS) },
      league: { is: { survivorMode: true } },
    },
    select: { leagueId: true, draftDateUtc: true, league: { select: { platform: true } } },
    take: 100,
  })
  let warned = 0
  for (const { leagueId, draftDateUtc, league } of upcoming) {
    if (!draftDateUtc || resolveWriteAuthority(league.platform) !== 'NATIVE') continue
    const session = await prisma.draftSession.findFirst({
      where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER,
      select: { status: true, sessionKind: true, sleeperDraftId: true, teamCount: true, rounds: true, slotOrder: true },
    })
    if (!session || session.status !== 'pre_draft' || session.sessionKind === 'mock' || session.sleeperDraftId) continue
    const readiness = await getSurvivorDraftStartReadiness(leagueId, session)
    if (readiness.ready) continue
    const outcome = await notifySurvivorCommissionerOnce(leagueId, 'seats_unclaimed_before_draft', {
      dedupeKey: draftDateUtc.toISOString(),
      title: 'Your Survivor draft starts in a day and cannot begin yet',
      body: `${readiness.error} Fill or release the seat before the scheduled time, or the draft waits.`,
      deepLinkPath: `/league/${leagueId}/draft`,
    })
    if (outcome.sent) warned++
  }
  return warned
}

/** Tells the commissioner, once per league, why the scheduled draft is waiting. */
async function noticeCastIncompleteOnce(leagueId: string, reason?: string) {
  const type = 'draft_cast_incomplete'
  if (await prisma.survivorNotification.findFirst({ where: { leagueId, type }, select: { id: true } })) return
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } })
  if (!league?.userId) return
  await enqueueNotification(leagueId, type, {
    recipientUserId: league.userId,
    title: 'Your draft is waiting on open seats',
    body: `${reason ?? 'Every seat must be claimed before the draft can start.'} The draft starts automatically once the cast is complete.`,
    deepLinkPath: `/league/${leagueId}/draft`,
    urgency: 'high',
  })
}
