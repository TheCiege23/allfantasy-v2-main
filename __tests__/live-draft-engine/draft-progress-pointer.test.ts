/**
 * The hosted draft's "next pick" pointer (lib/live-draft-engine/draftProgressPointer.ts). It used to stay at 1
 * for the whole draft; Draft HQ, the board and Chimmy's advice read it.
 */
import { describe, expect, it } from 'vitest'
import { draftProgressPointer, syncDraftProgressPointer } from '@/lib/live-draft-engine/draftProgressPointer'

const pick = (overall: number, playerName = `P${overall}`, position = 'C', pickMetadata: unknown = null) => ({ overall, playerName, position, pickMetadata })

describe('draftProgressPointer', () => {
  it('points past the picks already made (the paused 16-team NBA draft: 3 made → pick 4, round 1)', () => {
    expect(draftProgressPointer([pick(1), pick(2), pick(3)], 9, 16)).toEqual({ nextOverallPick: 4, currentRoundNum: 1 })
  })
  it('moves to the next round after the last pick of a round', () => {
    expect(draftProgressPointer([1, 2, 3, 4].map((o) => pick(o)), 3, 4)).toEqual({ nextOverallPick: 5, currentRoundNum: 2 })
  })
  it('points at a commissioner-cleared pick before later ones', () => {
    expect(draftProgressPointer([pick(1), pick(2, '', 'EMPTY'), pick(3)], 2, 4).nextOverallPick).toBe(2)
  })
  it('a full board points one past the end, round capped at the last', () => {
    expect(draftProgressPointer([1, 2, 3, 4].map((o) => pick(o)), 2, 2)).toEqual({ nextOverallPick: 5, currentRoundNum: 2 })
  })
  it('an empty board is pick 1, round 1', () => {
    expect(draftProgressPointer([], 9, 16)).toEqual({ nextOverallPick: 1, currentRoundNum: 1 })
  })
})

describe('syncDraftProgressPointer', () => {
  function fakeTx(session: Record<string, unknown> | null) {
    const updates: unknown[] = []
    return {
      updates,
      draftSession: {
        findUnique: async () => session,
        update: async (args: unknown) => { updates.push(args) },
      },
    }
  }
  it('stores the pointer the pick rows imply', async () => {
    const tx = fakeTx({ rounds: 9, teamCount: 16, nextOverallPick: 1, currentRoundNum: 1, picks: [pick(1), pick(2), pick(3)] })
    await syncDraftProgressPointer(tx, 's1')
    expect(tx.updates).toEqual([{ where: { id: 's1' }, data: { nextOverallPick: 4, currentRoundNum: 1 } }])
  })
  it('[control] writes nothing when the pointer is already right', async () => {
    const tx = fakeTx({ rounds: 9, teamCount: 16, nextOverallPick: 4, currentRoundNum: 1, picks: [pick(1), pick(2), pick(3)] })
    await syncDraftProgressPointer(tx, 's1')
    expect(tx.updates).toEqual([])
  })
  it('does nothing for a missing session', async () => {
    const tx = fakeTx(null)
    await syncDraftProgressPointer(tx, 's1')
    expect(tx.updates).toEqual([])
  })
})
