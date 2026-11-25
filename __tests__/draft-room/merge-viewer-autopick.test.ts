import { describe, expect, it } from 'vitest'
import { mergeDraftSessionSnapshot } from '@/lib/draft-room/mergeDraftSessionSnapshot'
import type { DraftSessionSnapshot } from '@/lib/live-draft-engine/types'

/**
 * A missed clock turns the viewer's "Auto-pick me" on from the server. Seen live on 2026-11-25: the
 * seat read AUTO while the room still held `viewerAutopick.enabled: false`.
 */
const off = { enabled: false, mode: 'standard' as const, isProEligible: true, updatedAt: null }
const on = { enabled: true, mode: 'standard' as const, isProEligible: true, updatedAt: '2026-11-25T14:08:38.000Z' }

function session(overrides: Partial<DraftSessionSnapshot> = {}): DraftSessionSnapshot {
  return {
    id: 'sess-1',
    leagueId: 'lg-1',
    status: 'in_progress',
    draftType: 'snake',
    rounds: 3,
    teamCount: 2,
    thirdRoundReversal: false,
    onClockTradeTimerBehavior: 'inherit_remaining',
    inDraftPlayerTradesEnabled: false,
    customRankingsEnabled: false,
    timerSeconds: 60,
    timerEndAt: null,
    pausedRemainingSeconds: null,
    slotOrder: [
      { slot: 1, rosterId: 'roster-1', displayName: 'Team 1' },
      { slot: 2, rosterId: 'roster-2', displayName: 'Team 2' },
    ],
    tradedPicks: [],
    version: 1,
    picks: [],
    currentPick: { overall: 1, round: 1, slot: 1, rosterId: 'roster-1', displayName: 'Team 1', pickLabel: '1.01' },
    timer: { status: 'running', remainingSeconds: 55, timerEndAt: null },
    updatedAt: '2026-01-01T00:00:00Z',
    viewerAutopick: off,
    ...overrides,
  } as DraftSessionSnapshot
}

describe('mergeDraftSessionSnapshot — viewerAutopick', () => {
  it('applies a change that arrives with no change to the board', () => {
    const prev = session()
    const merged = mergeDraftSessionSnapshot(prev, session({ viewerAutopick: on }))!
    expect(merged.viewerAutopick).toEqual(on)
  })

  it('returns the same object when the incoming value only looks new', () => {
    const prev = session()
    expect(mergeDraftSessionSnapshot(prev, session({ viewerAutopick: { ...off } }))).toBe(prev)
  })

  it('keeps the known value when a snapshot carries none for this viewer', () => {
    const prev = session({ viewerAutopick: on })
    expect(mergeDraftSessionSnapshot(prev, session({ viewerAutopick: null }))!.viewerAutopick).toEqual(on)
    // The same on a snapshot that also moves the board, where the incoming one is taken whole.
    const moved = { version: 2, updatedAt: '2026-01-01T00:01:00Z', currentPick: { overall: 2, round: 1, slot: 2, rosterId: 'roster-2', displayName: 'Team 2', pickLabel: '1.02' } }
    expect(mergeDraftSessionSnapshot(prev, session({ ...moved, viewerAutopick: null }))!.viewerAutopick).toEqual(on)
    expect(mergeDraftSessionSnapshot(prev, session({ ...moved, viewerAutopick: undefined }))!.viewerAutopick).toEqual(on)
  })
})
