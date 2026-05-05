/**
 * Server-side expired-pick processor: advances snake/linear drafts when timerEndAt has passed
 * and no browser is open. Uses the same queue-first → BPA flow as slow-draft automation.
 */

import 'server-only'

import { prisma } from '@/lib/prisma'
import { getDraftConfigForLeague } from '@/lib/draft-defaults/DraftRoomConfigResolver'
import { getDraftUISettingsForLeague, isSoftTimerEnabled } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { submitPick } from '@/lib/live-draft-engine/PickSubmissionService'
import { appendPickToRosterDraftSnapshot } from '@/lib/live-draft-engine/RosterAssignmentService'
import { computeTimerStateWithPauseWindow } from '@/lib/live-draft-engine/DraftTimerService'
import { reconcileOvernightDraftTimerForLeague } from '@/lib/live-draft-engine/DraftSessionService'
import { resolveCurrentOnTheClock } from '@/lib/live-draft-engine/CurrentOnTheClockResolver'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { tryQueueAutoPick } from '@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService'
import { submitBestAvailableAutopickForExpiredTimer } from '@/lib/live-draft-engine/autopickBestAvailableSubmit'
import { invalidateLeagueDraftCaches } from '@/lib/league/invalidateLeagueDraftCaches'
import { isLeagueRosterDraftReady } from '@/lib/league/league-roster-draft-gate'
import {
  notifyAutoPickFired,
  notifyDraftIntelPickConfirmation,
  notifyDraftIntelOnClockUrgent,
  notifyDraftIntelQueueReady,
  notifyOnTheClockAfterPick,
  notifyQueuePlayerUnavailable,
} from '@/lib/draft-notifications'
import { publishDraftIntelForUpcomingManagers, sendDraftIntelDm } from '@/lib/draft-intelligence'

type SlotOrderEntry = { slot: number; rosterId: string; displayName: string }
type TradedPickRecord = {
  round: number
  originalRosterId: string
  previousOwnerName: string
  newRosterId: string
  newOwnerName: string
}

export type ExpiredPickProcessDetail =
  | { leagueId: string; outcome: 'processed_queue'; rosterId: string; playerName: string }
  | { leagueId: string; outcome: 'processed_bpa'; rosterId: string; playerName: string }
  | { leagueId: string; outcome: 'processed_skip' }
  | { leagueId: string; outcome: 'skipped'; reason: string }
  | { leagueId: string; outcome: 'error'; message: string }

export type ProcessExpiredDraftPicksSummary = {
  scanned: number
  processed: number
  skipped: number
  errors: Array<{ leagueId: string; message: string }>
  details: ExpiredPickProcessDetail[]
}

async function fireAutopickSideEffects(
  leagueId: string,
  rosterId: string,
  playerName: string,
  queuePlayerUnavailable: boolean | undefined,
  pickLabel: string | null | undefined,
): Promise<void> {
  if (queuePlayerUnavailable) {
    void Promise.resolve(notifyQueuePlayerUnavailable(leagueId, rosterId)).catch(() => {})
  }
  void Promise.resolve(notifyAutoPickFired(leagueId, rosterId, playerName.trim())).catch(() => {})
  void Promise.resolve(notifyDraftIntelPickConfirmation(leagueId, rosterId, playerName.trim())).catch(() => {})
  void Promise.resolve(notifyOnTheClockAfterPick(leagueId)).catch(() => {})
  void (async () => {
    const states = await publishDraftIntelForUpcomingManagers({
      leagueId,
      trigger: 'pick_update',
    }).catch(() => [])
    for (const result of states) {
      const state = result.state
      await sendDraftIntelDm(state).catch(() => null)
      if (state.status === 'active' && state.picksUntilUser === 5 && state.queue[0]) {
        await notifyDraftIntelQueueReady(leagueId, state.rosterId, {
          playerName: state.queue[0].playerName,
          availabilityProbability: state.queue[0].availabilityProbability,
        }).catch(() => null)
      }
      if (state.status === 'on_clock') {
        await notifyDraftIntelOnClockUrgent(leagueId, state.rosterId, {
          playerName: state.queue[0]?.playerName,
          pickLabel: pickLabel ?? undefined,
        }).catch(() => null)
      }
    }
  })()
}

/**
 * Process one league if its draft timer is expired (snake/linear only). Idempotent under concurrency:
 * re-checks session/timer after roster gate; `submitPick` transaction rejects stale pick counts.
 */
export async function processExpiredDraftPickForLeague(
  leagueId: string,
  now: Date = new Date(),
): Promise<ExpiredPickProcessDetail> {
  try {
    if (!(await isLeagueRosterDraftReady(leagueId))) {
      return { leagueId, outcome: 'skipped', reason: 'roster_configuration_incomplete' }
    }

    const uiSettings = await getDraftUISettingsForLeague(leagueId)
    if (!uiSettings.autoPickEnabled) {
      return { leagueId, outcome: 'skipped', reason: 'auto_pick_disabled' }
    }
    // Slice 3 — Soft timer ON: expired clock does nothing. Draft waits for human / commissioner / NPC trigger.
    if (isSoftTimerEnabled(uiSettings)) {
      return { leagueId, outcome: 'skipped', reason: 'soft_timer_enabled' }
    }

    await reconcileOvernightDraftTimerForLeague(leagueId, now)

    const session = await prisma.draftSession.findUnique({
      where: { leagueId },
      include: { picks: { orderBy: { overall: 'asc' } }, queues: true },
    })
    if (!session) {
      return { leagueId, outcome: 'skipped', reason: 'no_session' }
    }
    if (session.status !== 'in_progress') {
      return { leagueId, outcome: 'skipped', reason: `status_${session.status}` }
    }
    if (session.draftType === 'auction') {
      return { leagueId, outcome: 'skipped', reason: 'auction_not_supported' }
    }
    if (session.cpuAutoPick === false) {
      return { leagueId, outcome: 'skipped', reason: 'cpu_autopick_disabled' }
    }
    if (!session.timerEndAt || session.timerEndAt > now) {
      return { leagueId, outcome: 'skipped', reason: 'timer_not_expired' }
    }

    const pauseWindow =
      uiSettings.timerMode === 'overnight_pause' && uiSettings.slowDraftPauseWindow
        ? uiSettings.slowDraftPauseWindow
        : null
    const timer = computeTimerStateWithPauseWindow(
      {
        status: session.status,
        timerSeconds: session.timerSeconds,
        timerEndAt: session.timerEndAt,
        pausedRemainingSeconds: session.pausedRemainingSeconds,
        overnightFrozenPickSeconds: session.overnightFrozenPickSeconds ?? null,
      },
      now,
      pauseWindow,
    )
    if (timer.status !== 'expired') {
      return { leagueId, outcome: 'skipped', reason: `timer_${timer.status}` }
    }

    const versionAtEntry = session.version
    const timerEndAtEntry = session.timerEndAt.getTime()

    const slotOrder = (session.slotOrder as unknown as SlotOrderEntry[]) ?? []
    const tradedPicks = Array.isArray(session.tradedPicks)
      ? (session.tradedPicks as unknown as TradedPickRecord[])
      : []
    const teamCount = session.teamCount
    const totalPicks = session.rounds * teamCount
    const progressPicks = session.picks.map((p) => ({
      overall: p.overall,
      playerName: p.playerName,
      position: p.position,
      pickMetadata: (p as { pickMetadata?: unknown | null }).pickMetadata ?? null,
    }))
    const current = resolveCurrentOnTheClock({
      totalPicks,
      picks: progressPicks,
      teamCount,
      draftType: session.draftType as 'snake' | 'linear' | 'auction',
      thirdRoundReversal: session.thirdRoundReversal,
      slotOrder,
    })
    if (!current) {
      return { leagueId, outcome: 'skipped', reason: 'no_current_pick' }
    }
    const resolvedOwner = resolvePickOwner(current.round, current.slot, slotOrder, tradedPicks)
    const onClockRosterId = resolvedOwner?.rosterId ?? current.rosterId
    if (!onClockRosterId) {
      return { leagueId, outcome: 'skipped', reason: 'no_on_clock_roster' }
    }

    const fresh = await prisma.draftSession.findUnique({
      where: { leagueId },
      select: {
        version: true,
        timerEndAt: true,
        status: true,
      },
    })
    if (
      !fresh ||
      fresh.status !== 'in_progress' ||
      fresh.version !== versionAtEntry ||
      !fresh.timerEndAt ||
      fresh.timerEndAt.getTime() !== timerEndAtEntry
    ) {
      return { leagueId, outcome: 'skipped', reason: 'stale_session' }
    }

    const queuePick = await tryQueueAutoPick(leagueId, onClockRosterId)
    if (queuePick.success && queuePick.playerName) {
      invalidateLeagueDraftCaches(leagueId)
      try {
        const lastPick = await prisma.draftPick.findFirst({
          where: { sessionId: session.id },
          orderBy: { overall: 'desc' },
          select: { playerName: true, position: true, team: true, playerId: true, byeWeek: true },
        })
        if (lastPick) {
          await appendPickToRosterDraftSnapshot(leagueId, onClockRosterId, {
            playerName: lastPick.playerName,
            position: lastPick.position,
            team: lastPick.team,
            playerId: lastPick.playerId,
            byeWeek: lastPick.byeWeek,
          }).catch(() => {})
        }
      } catch {
        /* non-fatal */
      }
      void fireAutopickSideEffects(
        leagueId,
        onClockRosterId,
        queuePick.playerName,
        queuePick.queuePlayerUnavailable,
        current.pickLabel,
      )
      return {
        leagueId,
        outcome: 'processed_queue',
        rosterId: onClockRosterId,
        playerName: queuePick.playerName.trim(),
      }
    }

    const mid = await prisma.draftSession.findUnique({
      where: { leagueId },
      select: {
        version: true,
        status: true,
        timerEndAt: true,
      },
    })
    if (!mid || mid.status !== 'in_progress') {
      return { leagueId, outcome: 'skipped', reason: 'stale_mid' }
    }
    if (mid.version !== versionAtEntry) {
      return { leagueId, outcome: 'skipped', reason: 'stale_after_queue' }
    }
    if (mid.timerEndAt && mid.timerEndAt > now) {
      return { leagueId, outcome: 'skipped', reason: 'timer_advanced' }
    }

    const draftRoomConfig = await getDraftConfigForLeague(leagueId)
    const autoPickBehavior = String(draftRoomConfig?.autopick_behavior ?? 'queue-first').toLowerCase()

    // Commit Q — overall this expired-pick processor is targeting; flow
    // it into both submitPick (skip) and the BPA autopick helper so the
    // Commit-M stale-overall guard fires when another writer beats us
    // to the commit.
    const expectedOverall = session.picks.length + 1

    if (autoPickBehavior === 'skip') {
      const skip = await submitPick({
        leagueId,
        playerName: '(Skipped)',
        position: 'SKIP',
        rosterId: onClockRosterId,
        source: 'auto',
        expectedOverall,
      })
      if (!skip.success) {
        return { leagueId, outcome: 'error', message: skip.error ?? 'skip_submit_failed' }
      }
      invalidateLeagueDraftCaches(leagueId)
      if (queuePick.queuePlayerUnavailable) {
        void notifyQueuePlayerUnavailable(leagueId, onClockRosterId)
      }
      void notifyOnTheClockAfterPick(leagueId)
      void (async () => {
        const states = await publishDraftIntelForUpcomingManagers({
          leagueId,
          trigger: 'pick_update',
        }).catch(() => [])
        for (const result of states) {
          await sendDraftIntelDm(result.state).catch(() => null)
        }
      })()
      return { leagueId, outcome: 'processed_skip' }
    }

    const bpa = await submitBestAvailableAutopickForExpiredTimer(leagueId, onClockRosterId, expectedOverall)
    if (!bpa.ok) {
      return {
        leagueId,
        outcome: 'skipped',
        reason: bpa.error === 'no_pool' ? 'no_bpa_candidate' : 'bpa_submit_failed',
      }
    }

    invalidateLeagueDraftCaches(leagueId)
    try {
      const lastPick = await prisma.draftPick.findFirst({
        where: { sessionId: session.id },
        orderBy: { overall: 'desc' },
        select: { playerName: true, position: true, team: true, playerId: true, byeWeek: true },
      })
      if (lastPick) {
        await appendPickToRosterDraftSnapshot(leagueId, onClockRosterId, {
          playerName: lastPick.playerName,
          position: lastPick.position,
          team: lastPick.team,
          playerId: lastPick.playerId,
          byeWeek: lastPick.byeWeek,
        }).catch(() => {})
      }
    } catch {
      /* non-fatal */
    }
    void fireAutopickSideEffects(
      leagueId,
      onClockRosterId,
      bpa.pick.playerName,
      queuePick.queuePlayerUnavailable,
      current.pickLabel,
    )
    return {
      leagueId,
      outcome: 'processed_bpa',
      rosterId: onClockRosterId,
      playerName: bpa.pick.playerName.trim(),
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { leagueId, outcome: 'error', message }
  }
}

export type ProcessExpiredDraftPicksOptions = {
  now?: Date
  /** Max leagues to scan from DB (safety cap). */
  maxLeagues?: number
}

/**
 * Find in-progress snake/linear drafts with expired pick timers and process each.
 */
export async function processExpiredDraftPicks(
  options: ProcessExpiredDraftPicksOptions = {},
): Promise<ProcessExpiredDraftPicksSummary> {
  const now = options.now ?? new Date()
  const maxLeagues = Math.min(Math.max(options.maxLeagues ?? 40, 1), 200)

  const candidates = await prisma.draftSession.findMany({
    where: {
      status: 'in_progress',
      draftType: { in: ['snake', 'linear'] },
      timerEndAt: { lte: now },
    },
    select: { leagueId: true },
    orderBy: { timerEndAt: 'asc' },
    take: maxLeagues,
  })

  const details: ExpiredPickProcessDetail[] = []
  const errors: Array<{ leagueId: string; message: string }> = []
  let processed = 0
  let skipped = 0

  for (const row of candidates) {
    const detail = await processExpiredDraftPickForLeague(row.leagueId, now)
    details.push(detail)
    if (detail.outcome === 'error') {
      errors.push({ leagueId: detail.leagueId, message: detail.message })
      continue
    }
    if (
      detail.outcome === 'processed_queue' ||
      detail.outcome === 'processed_bpa' ||
      detail.outcome === 'processed_skip'
    ) {
      processed += 1
    } else {
      skipped += 1
    }
  }

  return {
    scanned: candidates.length,
    processed,
    skipped,
    errors,
    details,
  }
}
