import { prisma } from '@/lib/prisma'
import { getDraftConfigForLeague } from '@/lib/draft-defaults/DraftRoomConfigResolver'
import { getDraftUISettingsForLeague, isSoftTimerEnabled } from '@/lib/draft-defaults/DraftUISettingsResolver'
import { submitBestAvailableAutopickForExpiredTimer } from '@/lib/live-draft-engine/autopickBestAvailableSubmit'
import { getAllowedPositionsAndRosterSize } from '@/lib/live-draft-engine/RosterFitValidation'
import { filterEntriesByDraftEligiblePositions } from '@/lib/draft-room/draft-pool-eligible-positions'
import { computeTimerStateWithPauseWindow, isInsidePauseWindow } from '@/lib/live-draft-engine/DraftTimerService'
import { pauseDraftSession, resumeDraftSession } from '@/lib/live-draft-engine/DraftSessionService'
import { resolveCurrentOnTheClock } from '@/lib/live-draft-engine/CurrentOnTheClockResolver'
import { resolvePickOwner } from '@/lib/live-draft-engine/PickOwnershipResolver'
import { submitPick } from '@/lib/live-draft-engine/PickSubmissionService'
import {
  createDraftNotification,
  getAppUserIdForRoster,
  notifyDraftIntelOnClockUrgent,
  notifyDraftIntelPickConfirmation,
  notifyDraftIntelQueueReady,
  notifyApproachingTimeout,
  notifyAutoPickFired,
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

type SlowRuntimeMeta = {
  autoPausedByWindow?: boolean
  reminderOverallPick?: number | null
  approachingTimeoutOverallPick?: number | null
}

type SlowDraftAutomationAction =
  | { type: 'pause_window_started' }
  | { type: 'pause_window_ended' }
  | { type: 'auto_pick'; rosterId: string; playerName: string }
  | { type: 'auto_skip'; rosterId: string }
  | { type: 'slow_reminder'; rosterId: string; minutesRemaining: number }
  | { type: 'approaching_timeout'; rosterId: string; secondsRemaining: number }

export type SlowDraftAutomationTickResult = {
  changed: boolean
  actions: SlowDraftAutomationAction[]
}

const RUNTIME_META_KEY = 'draft_slow_runtime_meta'

function readRuntimeMeta(settings: Record<string, unknown>): SlowRuntimeMeta {
  const raw = settings[RUNTIME_META_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const cast = raw as Record<string, unknown>
  return {
    autoPausedByWindow: cast.autoPausedByWindow === true,
    reminderOverallPick:
      typeof cast.reminderOverallPick === 'number' && Number.isFinite(cast.reminderOverallPick)
        ? Math.max(0, Math.floor(cast.reminderOverallPick))
        : null,
    approachingTimeoutOverallPick:
      typeof cast.approachingTimeoutOverallPick === 'number' && Number.isFinite(cast.approachingTimeoutOverallPick)
        ? Math.max(0, Math.floor(cast.approachingTimeoutOverallPick))
        : null,
  }
}

async function writeRuntimeMeta(leagueId: string, settings: Record<string, unknown>, meta: SlowRuntimeMeta) {
  const nextSettings = {
    ...settings,
    [RUNTIME_META_KEY]: {
      autoPausedByWindow: meta.autoPausedByWindow === true,
      reminderOverallPick:
        typeof meta.reminderOverallPick === 'number' && Number.isFinite(meta.reminderOverallPick)
          ? Math.max(0, Math.floor(meta.reminderOverallPick))
          : null,
      approachingTimeoutOverallPick:
        typeof meta.approachingTimeoutOverallPick === 'number' && Number.isFinite(meta.approachingTimeoutOverallPick)
          ? Math.max(0, Math.floor(meta.approachingTimeoutOverallPick))
          : null,
    },
  }
  await prisma.league.update({
    where: { id: leagueId },
    data: { settings: nextSettings as any, updatedAt: new Date() },
  })
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase()
}

/** Exported for integration tests (`tryQueueAutoPick` slow-draft path). */
export async function tryQueueAutoPick(
  leagueId: string,
  rosterId: string
): Promise<{ success: boolean; playerName?: string; queuePlayerUnavailable?: boolean }> {
  const draftSession = await prisma.draftSession.findUnique({
    where: { leagueId },
    include: { picks: { orderBy: { overall: 'asc' } }, queues: true },
  })
  if (!draftSession || draftSession.status !== 'in_progress') return { success: false }

  const onClockRoster = await prisma.roster.findUnique({
    where: { id: rosterId },
    select: { platformUserId: true },
  })
  const queueUserId =
    onClockRoster?.platformUserId && !String(onClockRoster.platformUserId).startsWith('orphan-')
      ? String(onClockRoster.platformUserId)
      : null
  if (!queueUserId) return { success: false }

  const queueRow = draftSession.queues.find((q) => q.userId === queueUserId)
  const queueOrder = Array.isArray(queueRow?.order)
    ? (queueRow.order as Array<{ playerName: string; position: string; team?: string | null; playerId?: string | null }>)
    : []
  if (queueOrder.length === 0) return { success: false }

  const draftedNames = new Set(draftSession.picks.map((p) => normalizeName(p.playerName)))
  const queuePlayerUnavailable = queueOrder.some((entry) => draftedNames.has(normalizeName(String(entry.playerName ?? ''))))
  const queueCandidates = queueOrder.filter((entry) => {
    const playerName = String(entry.playerName ?? '').trim()
    const position = String(entry.position ?? '').trim()
    if (!playerName || !position) return false
    return !draftedNames.has(normalizeName(playerName))
  })

  const rosterRules = await getAllowedPositionsAndRosterSize(leagueId)
  const draftEligiblePositions = rosterRules?.draftEligiblePositions
  const eligibleQueueCandidates = filterEntriesByDraftEligiblePositions(queueCandidates, draftEligiblePositions)

  // Commit Q — pass `expectedOverall` to each submitPick attempt so the
  // Commit-M stale-overall guard short-circuits the candidate loop the
  // moment another writer (concurrent cron, manager browser pick, etc.)
  // advances the draft. Without this, the loop would keep trying the
  // next candidate against a stale view; submitPick's internal in-tx
  // race guard still catches it, but bailing on the first STALE_OVERALL
  // saves a flurry of doomed retries.
  const expectedOverall = draftSession.picks.length + 1

  for (const entry of eligibleQueueCandidates.slice(0, 30)) {
    const attempt = await submitPick({
      leagueId,
      playerName: String(entry.playerName ?? '').trim(),
      position: String(entry.position ?? '').trim(),
      team: entry.team ?? null,
      playerId: entry.playerId ?? null,
      rosterId,
      source: 'auto',
      expectedOverall,
    })
    if (attempt.success) {
      return { success: true, playerName: String(entry.playerName ?? '').trim(), queuePlayerUnavailable }
    }
    // Commit Q — bail on stale-overall: another writer landed a pick
    // since we loaded the session. Re-running the cron tick will pick
    // up the fresh state.
    if (attempt.code === 'DRAFT_PICK_STALE_OVERALL' || attempt.code === 'DRAFT_PICK_RACE_RETRY') {
      return { success: false, queuePlayerUnavailable }
    }
  }

  return { success: false, queuePlayerUnavailable }
}

export async function runSlowDraftAutomationTick(
  leagueId: string,
  now: Date = new Date()
): Promise<SlowDraftAutomationTickResult> {
  const actions: SlowDraftAutomationAction[] = []
  let changed = false

  const [league, uiSettings] = await Promise.all([
    prisma.league.findUnique({
      where: { id: leagueId },
      select: { settings: true },
    }),
    getDraftUISettingsForLeague(leagueId),
  ])
  const leagueSettings = ((league?.settings as Record<string, unknown>) ?? {}) as Record<string, unknown>
  const runtimeMeta = readRuntimeMeta(leagueSettings)
  let nextRuntimeMeta: SlowRuntimeMeta = { ...runtimeMeta }

  let session = await prisma.draftSession.findUnique({
    where: { leagueId },
    include: { picks: { orderBy: { overall: 'asc' } } },
  })
  if (!session || session.draftType === 'auction') {
    return { changed: false, actions }
  }

  const pauseWindow =
    uiSettings.timerMode === 'overnight_pause' && uiSettings.slowDraftPauseWindow
      ? uiSettings.slowDraftPauseWindow
      : null
  const insidePauseWindow = pauseWindow ? isInsidePauseWindow(now, pauseWindow) : false

  if (pauseWindow && session.status === 'in_progress' && insidePauseWindow) {
    if (!uiSettings.allowPicksDuringOvernightPause) {
      // Default: pause session to block all picks during the window.
      const paused = await pauseDraftSession(leagueId)
      if (paused) {
        changed = true
        actions.push({ type: 'pause_window_started' })
        nextRuntimeMeta.autoPausedByWindow = true
        session = await prisma.draftSession.findUnique({
          where: { leagueId },
          include: { picks: { orderBy: { overall: 'asc' } } },
        })
      }
    } else if (!runtimeMeta.autoPausedByWindow) {
      // allowPicksDuringOvernightPause=true: leave session in_progress so managers can still pick.
      // reconcileOvernightDraftTimerForLeague freezes timerEndAt→null + sets overnightFrozenPickSeconds,
      // which prevents the expired-pick worker from auto-picking during the window.
      changed = true
      actions.push({ type: 'pause_window_started' })
      nextRuntimeMeta.autoPausedByWindow = true
    }
  }

  if (pauseWindow && !insidePauseWindow && runtimeMeta.autoPausedByWindow) {
    if (session?.status === 'paused') {
      const resumed = await resumeDraftSession(leagueId)
      if (resumed) {
        changed = true
        actions.push({ type: 'pause_window_ended' })
        nextRuntimeMeta.autoPausedByWindow = false
        session = await prisma.draftSession.findUnique({
          where: { leagueId },
          include: { picks: { orderBy: { overall: 'asc' } } },
        })
      }
    } else if (session?.status === 'in_progress' && uiSettings.allowPicksDuringOvernightPause) {
      // Picks were allowed during window: session stayed in_progress, just clear the meta flag.
      // Timer restoration already handled by reconcileOvernightDraftTimerForLeague.
      changed = true
      actions.push({ type: 'pause_window_ended' })
      nextRuntimeMeta.autoPausedByWindow = false
    }
  }

  if (!session) return { changed, actions }

  if (!pauseWindow && runtimeMeta.autoPausedByWindow) {
    if (session.status === 'paused') {
      const resumed = await resumeDraftSession(leagueId)
      if (resumed) {
        changed = true
        actions.push({ type: 'pause_window_ended' })
      }
    }
    nextRuntimeMeta.autoPausedByWindow = false
  }

  if (session.status === 'in_progress') {
    const timer = computeTimerStateWithPauseWindow(
      {
        status: session.status,
        timerSeconds: session.timerSeconds,
        timerEndAt: session.timerEndAt,
        pausedRemainingSeconds: session.pausedRemainingSeconds,
      },
      now,
      pauseWindow
    )

    const slotOrder = (session.slotOrder as unknown as SlotOrderEntry[]) ?? []
    const tradedPicks = Array.isArray(session.tradedPicks)
      ? (session.tradedPicks as unknown as TradedPickRecord[])
      : []
    const totalPicks = session.rounds * session.teamCount
    const progressPicks = session.picks.map((p) => ({
      overall: p.overall,
      playerName: p.playerName,
      position: p.position,
      pickMetadata: (p as { pickMetadata?: unknown | null }).pickMetadata ?? null,
    }))
    const current = resolveCurrentOnTheClock({
      totalPicks,
      picks: progressPicks,
      teamCount: session.teamCount,
      draftType: session.draftType as 'snake' | 'linear' | 'auction',
      thirdRoundReversal: session.thirdRoundReversal,
      slotOrder,
    })
    const resolvedOwner =
      current != null ? resolvePickOwner(current.round, current.slot, slotOrder, tradedPicks) : null
    const onClockRosterId = resolvedOwner?.rosterId ?? current?.rosterId ?? null

    // Slice 3 — Soft timer ON suppresses the slow-draft tick autopick gate. Same canonical helper as
    // processExpiredDraftPickForLeague. Pause/skip/notification side-effects below remain untouched.
    if (
      uiSettings.autoPickEnabled &&
      !isSoftTimerEnabled(uiSettings) &&
      timer.status === 'expired' &&
      onClockRosterId
    ) {
      const queuePick = await tryQueueAutoPick(leagueId, onClockRosterId)
      if (queuePick.success && queuePick.playerName) {
        changed = true
        actions.push({ type: 'auto_pick', rosterId: onClockRosterId, playerName: queuePick.playerName })
        nextRuntimeMeta.reminderOverallPick = null
        nextRuntimeMeta.approachingTimeoutOverallPick = null
        void notifyAutoPickFired(leagueId, onClockRosterId, queuePick.playerName)
        void notifyDraftIntelPickConfirmation(leagueId, onClockRosterId, queuePick.playerName).catch(() => {})
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
                pickLabel: current?.pickLabel,
              }).catch(() => null)
            }
          }
        })()
      } else {
        const draftRoomConfig = await getDraftConfigForLeague(leagueId)
        const autoPickBehavior = String(draftRoomConfig?.autopick_behavior ?? 'queue-first').toLowerCase()
        // Commit Q — overall the cron tick is targeting; passed through
        // both the skip and the BPA fallback paths so the Commit-M
        // stale-overall guard fires deterministically when another
        // writer lands a pick first.
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
          if (skip.success) {
            changed = true
            actions.push({ type: 'auto_skip', rosterId: onClockRosterId })
            nextRuntimeMeta.reminderOverallPick = null
            nextRuntimeMeta.approachingTimeoutOverallPick = null
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
          }
        } else {
          const bpa = await submitBestAvailableAutopickForExpiredTimer(leagueId, onClockRosterId, expectedOverall)
          if (bpa.ok) {
            changed = true
            actions.push({ type: 'auto_pick', rosterId: onClockRosterId, playerName: bpa.pick.playerName })
            nextRuntimeMeta.reminderOverallPick = null
            nextRuntimeMeta.approachingTimeoutOverallPick = null
            void notifyAutoPickFired(leagueId, onClockRosterId, bpa.pick.playerName)
            void notifyDraftIntelPickConfirmation(leagueId, onClockRosterId, bpa.pick.playerName).catch(() => {})
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
                    pickLabel: current?.pickLabel,
                  }).catch(() => null)
                }
              }
            })()
          }
        }
      }
    }

    if (
      timer.status === 'running' &&
      timer.remainingSeconds != null &&
      timer.remainingSeconds > 0 &&
      onClockRosterId &&
      current
    ) {
      const timeoutWarningThresholdSeconds = Math.max(20, Math.min(120, Math.floor((session.timerSeconds ?? 90) * 0.25)))
      const overall = current.overall
      if (
        timer.remainingSeconds <= timeoutWarningThresholdSeconds &&
        nextRuntimeMeta.approachingTimeoutOverallPick !== overall
      ) {
        void notifyApproachingTimeout(leagueId, onClockRosterId, {
          pickLabel: current.pickLabel,
          round: current.round,
          slot: current.slot,
        })
        actions.push({
          type: 'approaching_timeout',
          rosterId: onClockRosterId,
          secondsRemaining: timer.remainingSeconds,
        })
        nextRuntimeMeta.approachingTimeoutOverallPick = overall
      }
    }

    const isSlowDraft = (session.timerSeconds ?? 0) >= 3600 || uiSettings.timerMode === 'overnight_pause'
    if (
      isSlowDraft &&
      timer.status === 'running' &&
      timer.remainingSeconds != null &&
      timer.remainingSeconds > 0 &&
      timer.remainingSeconds <= 15 * 60 &&
      onClockRosterId &&
      current
    ) {
      const overall = current.overall
      if (nextRuntimeMeta.reminderOverallPick !== overall) {
        const appUserId = await getAppUserIdForRoster(onClockRosterId)
        if (appUserId) {
          const minutesRemaining = Math.max(1, Math.ceil(timer.remainingSeconds / 60))
          await createDraftNotification(appUserId, 'draft_slow_reminder', {
            leagueId,
            rosterId: onClockRosterId,
            pickLabel: current.pickLabel,
            round: current.round,
            slot: current.slot,
            minutesRemaining,
          }).catch(() => {})
          actions.push({ type: 'slow_reminder', rosterId: onClockRosterId, minutesRemaining })
          nextRuntimeMeta.reminderOverallPick = overall
        }
      }
    } else if (timer.status !== 'running') {
      nextRuntimeMeta.reminderOverallPick = null
      nextRuntimeMeta.approachingTimeoutOverallPick = null
    }
  } else if (session.status === 'completed' || session.status === 'pre_draft') {
    nextRuntimeMeta.autoPausedByWindow = false
    nextRuntimeMeta.reminderOverallPick = null
    nextRuntimeMeta.approachingTimeoutOverallPick = null
  }

  const runtimeMetaChanged =
    nextRuntimeMeta.autoPausedByWindow !== runtimeMeta.autoPausedByWindow ||
    nextRuntimeMeta.reminderOverallPick !== runtimeMeta.reminderOverallPick ||
    nextRuntimeMeta.approachingTimeoutOverallPick !== runtimeMeta.approachingTimeoutOverallPick
  if (runtimeMetaChanged) {
    await writeRuntimeMeta(leagueId, leagueSettings, nextRuntimeMeta)
  }

  return { changed, actions }
}
