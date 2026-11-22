import type { PlayerEntry } from '@/components/app/draft-room/PlayerPanel'
import type { CurrentOnTheClock, DraftSessionSnapshot } from '@/lib/live-draft-engine/types'
import type { DraftRoomTimerMode } from '@/lib/draft-room/draftRoomGateState'
import { deriveDraftRoomGateState } from '@/lib/draft-room/draftRoomGateState'
import type { buildDraftRoomCoreState } from '@/lib/live-draft-engine'

type DraftCore = ReturnType<typeof buildDraftRoomCoreState> | null

type DraftRoomPageDerivedState = {
  status: DraftSessionSnapshot['status']
  /** Board layout: snake / linear / auction — same as session draftType when loaded. */
  boardMode: DraftSessionSnapshot['draftType']
  isAuction: boolean
  isDraftCompleted: boolean
  currentPick: CurrentOnTheClock | null
  timerMode: DraftRoomTimerMode
  /** Anchor for pick clock (ISO), null when blocked or missing. */
  timerEndAt: string | null
  /** Seconds frozen on clock when paused; null when not paused or unknown. */
  pausedRemainingSeconds: number | null
  rosterConfigurationIncomplete: boolean
  rosterConfigurationMessage: string | null
  canDraft: boolean
  canStart: boolean
  canPause: boolean
  canResume: boolean
  canNominate: boolean
  canBid: boolean
  players: PlayerEntry[]
  picks: DraftSessionSnapshot['picks']
  draftedNames: Set<string>
  draftedPlayerIds: Set<string>
  /**
   * Sidebar pick timer: hidden for auction (spotlight owns it), completed,
   * and roster-configuration gate. Shown in pre_draft so the live column keeps the same
   * vertical chrome as in_progress (timer reads idle until Start).
   */
  sidebarTimerVisible: boolean
}

export function buildDraftRoomPageDerivedState(input: {
  session: DraftSessionSnapshot | null
  draftCore: DraftCore
  currentPick: CurrentOnTheClock | null
  players: PlayerEntry[]
  draftedNames: Set<string>
  draftedPlayerIds: Set<string>
  isCommissioner: boolean
  rosterConfigurationIncomplete: boolean
  rosterConfigurationMessage: string | null
  snakeCanDraft: boolean
  auctionCanNominate: boolean
  auctionCanBid: boolean
}): DraftRoomPageDerivedState {
  const {
    session,
    draftCore,
    currentPick,
    players,
    draftedNames,
    draftedPlayerIds,
    isCommissioner,
    rosterConfigurationIncomplete,
    rosterConfigurationMessage,
    snakeCanDraft,
    auctionCanNominate,
    auctionCanBid,
  } = input

  const gate = deriveDraftRoomGateState({
    session,
    rosterConfigurationIncomplete,
    rosterConfigurationMessage,
    snakeCanDraft,
    auctionCanNominate,
    auctionCanBid,
  })

  const status: DraftSessionSnapshot['status'] = session?.status ?? 'pre_draft'
  const boardMode: DraftSessionSnapshot['draftType'] = session?.draftType ?? 'snake'
  const isAuction = boardMode === 'auction'
  const isDraftCompleted = status === 'completed'
  const picks = session?.picks ?? []

  const timerEndAt =
    gate.timerMode === 'blocked'
      ? null
      : session?.timer?.status === 'paused'
        ? session.timer.timerEndAt
        : session?.timer?.status === 'running' && session.timer.timerEndAt
          ? session.timer.timerEndAt
          : draftCore?.timerEndAt ?? session?.timer?.timerEndAt ?? session?.timerEndAt ?? null

  const pausedRemainingSeconds =
    gate.timerMode === 'paused'
      ? (session?.timer?.remainingSeconds ?? session?.pausedRemainingSeconds ?? null)
      : null

  const rosterIncomplete = gate.rosterConfigurationIncomplete
  const canStart = isCommissioner && status === 'pre_draft' && !rosterIncomplete
  const canPause = isCommissioner && status === 'in_progress'
  const canResume = isCommissioner && status === 'paused'

  const sidebarTimerVisible = !isAuction && !isDraftCompleted && gate.timerMode !== 'blocked'

  return {
    status,
    boardMode,
    isAuction,
    isDraftCompleted,
    currentPick,
    timerMode: gate.timerMode,
    timerEndAt,
    pausedRemainingSeconds,
    rosterConfigurationIncomplete: gate.rosterConfigurationIncomplete,
    rosterConfigurationMessage: gate.rosterConfigurationMessage ?? session?.rosterConfigurationMessage ?? null,
    canDraft: gate.canDraft,
    canStart,
    canPause,
    canResume,
    canNominate: gate.canNominate,
    canBid: gate.canBid,
    players,
    picks,
    draftedNames,
    draftedPlayerIds,
    sidebarTimerVisible,
  }
}
