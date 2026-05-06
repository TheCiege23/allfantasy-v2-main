import { describe, expect, it } from 'vitest'

import { getDraftPickActionState, normalizeDraftRosterId } from '@/lib/draft-room/draftPickEligibility'
import type { CurrentOnTheClock, DraftSessionSnapshot } from '@/lib/live-draft-engine/types'
import type { DraftRoomCoreState } from '@/lib/live-draft-engine/types'

function core(partial: Partial<DraftRoomCoreState>): DraftRoomCoreState {
  return {
    draftStarted: true,
    currentOverall: 1,
    currentRound: 1,
    currentPickInRound: 1,
    currentTeamId: 'r1',
    timerEndAt: '',
    picks: [],
    ...partial,
  }
}

function sessionBase(partial: Partial<DraftSessionSnapshot>): DraftSessionSnapshot {
  return {
    id: 'd1',
    leagueId: 'l1',
    status: 'in_progress',
    draftType: 'snake',
    rounds: 15,
    teamCount: 12,
    thirdRoundReversal: false,
    onClockTradeTimerBehavior: 'inherit_remaining',
    inDraftPlayerTradesEnabled: false,
    customRankingsEnabled: false,
    timerSeconds: 90,
    timerEndAt: null,
    pausedRemainingSeconds: null,
    slotOrder: [],
    tradedPicks: [],
    version: 1,
    picks: [],
    currentPick: null,
    timer: { status: 'running', remainingSeconds: 30, timerEndAt: '2026-01-01T00:01:00.000Z' },
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  } as DraftSessionSnapshot
}

describe('getDraftPickActionState', () => {
  const cp: CurrentOnTheClock = {
    overall: 3,
    round: 1,
    slot: 3,
    rosterId: '  roster-a  ',
    displayName: 'Team A',
    pickLabel: '1.03',
  }

  it('viewer roster on clock + active draft core → can pick (snake raw true)', () => {
    const st = getDraftPickActionState({
      session: sessionBase({}),
      draftCore: core({ currentOverall: 3 }),
      currentPick: cp,
      currentUserRosterId: 'roster-a',
      overnightBlocksUserPicks: false,
      pickSubmitting: false,
      commissionerOfflinePick: false,
    })
    expect(st.viewerOnClock).toBe(true)
    expect(st.topBarOnClockRosterId).toBe('roster-a')
    expect(st.viewerRosterId).toBe('roster-a')
    expect(st.canPick).toBe(true)
    expect(st.snakeCanDraftRaw).toBe(true)
    expect(st.denialReason).toBe('eligible')
  })

  it('viewer not on clock → not_your_pick', () => {
    const st = getDraftPickActionState({
      session: sessionBase({}),
      draftCore: core({ currentOverall: 3 }),
      currentPick: cp,
      currentUserRosterId: 'roster-b',
      overnightBlocksUserPicks: false,
      pickSubmitting: false,
      commissionerOfflinePick: false,
    })
    expect(st.viewerOnClock).toBe(false)
    expect(st.snakeCanDraftRaw).toBe(false)
    expect(st.denialReason).toBe('not_your_pick')
  })

  it('paused session → draft_paused', () => {
    const st = getDraftPickActionState({
      session: sessionBase({ status: 'paused' }),
      draftCore: core({ currentOverall: 3 }),
      currentPick: cp,
      currentUserRosterId: 'roster-a',
      overnightBlocksUserPicks: false,
      pickSubmitting: false,
      commissionerOfflinePick: false,
    })
    expect(st.snakeCanDraftRaw).toBe(false)
    expect(st.denialReason).toBe('draft_paused')
  })

  it('pick submitting → pick_in_flight', () => {
    const st = getDraftPickActionState({
      session: sessionBase({}),
      draftCore: core({ currentOverall: 3 }),
      currentPick: cp,
      currentUserRosterId: 'roster-a',
      overnightBlocksUserPicks: false,
      pickSubmitting: true,
      commissionerOfflinePick: false,
    })
    expect(st.snakeCanDraftRaw).toBe(false)
    expect(st.denialReason).toBe('pick_in_flight')
  })

  it('top bar clock roster id matches viewer roster id when trimmed', () => {
    const st = getDraftPickActionState({
      session: sessionBase({}),
      draftCore: core({ currentOverall: 3 }),
      currentPick: cp,
      currentUserRosterId: '  roster-a',
      overnightBlocksUserPicks: false,
      pickSubmitting: false,
      commissionerOfflinePick: false,
    })
    expect(st.viewerOnClock).toBe(true)
    expect(st.topBarOnClockRosterId).toBe(normalizeDraftRosterId(cp.rosterId))
  })

  it('commissioner offline mode allows snake raw without being on clock', () => {
    const st = getDraftPickActionState({
      session: sessionBase({}),
      draftCore: core({ currentOverall: 3 }),
      currentPick: cp,
      currentUserRosterId: 'other-roster',
      overnightBlocksUserPicks: false,
      pickSubmitting: false,
      commissionerOfflinePick: true,
    })
    expect(st.viewerOnClock).toBe(false)
    expect(st.snakeCanDraftRaw).toBe(true)
  })
})
