import { describe, it, expect } from 'vitest'
import {
  buildDraftBoard,
  isRoundReversed,
  pickLabel,
  cellForSlot,
} from '@/lib/draft-board/draftBoardGrid'

/**
 * The snake rule previously existed in three copies (DraftBoard.tsx, DraftOrderService,
 * KeeperDraftOrder). These pin the single version, including the case all three get right
 * today and would be easy to break: third-round reversal repeats round 2's direction
 * rather than flipping, so R3 runs backwards and the alternation resumes at R4.
 */
describe('round direction', () => {
  it('snake alternates from round 1', () => {
    const dirs = [1, 2, 3, 4, 5, 6].map((round) => isRoundReversed({ round, kind: 'snake' }))
    expect(dirs).toEqual([false, true, false, true, false, true])
  })

  it('linear never reverses — that is the format', () => {
    const dirs = [1, 2, 3, 4, 5].map((round) => isRoundReversed({ round, kind: 'linear' }))
    expect(dirs).toEqual([false, false, false, false, false])
  })

  it('third-round reversal repeats round 2 instead of flipping', () => {
    const dirs = [1, 2, 3, 4, 5, 6, 7].map((round) =>
      isRoundReversed({ round, kind: 'snake', thirdRoundReversal: true }),
    )
    // R1 fwd, R2 rev, R3 rev, then alternating again from R4.
    expect(dirs).toEqual([false, true, true, false, true, false, true])
  })

  it('3RR only applies to snake — a linear league ignores it', () => {
    const dirs = [1, 2, 3].map((round) =>
      isRoundReversed({ round, kind: 'linear', thirdRoundReversal: true }),
    )
    expect(dirs).toEqual([false, false, false])
  })
})

describe('board construction', () => {
  it('numbers picks continuously across rounds', () => {
    const board = buildDraftBoard({ rounds: 3, teamCount: 12, kind: 'snake' })
    expect(board[0].cells[0].overall).toBe(1)
    expect(board[0].cells[11].overall).toBe(12)
    expect(board[1].cells[0].overall).toBe(13)
    expect(board[2].cells[11].overall).toBe(36)
  })

  it('labels picks the way managers say them', () => {
    expect(pickLabel(1, 4)).toBe('1.04')
    expect(pickLabel(12, 12)).toBe('12.12')
  })

  it('gives the first board column of a reversed round to the LAST slot', () => {
    const board = buildDraftBoard({ rounds: 2, teamCount: 12, kind: 'snake' })
    expect(board[0].cells[0].slot).toBe(1) // R1 forward
    expect(board[1].reversed).toBe(true)
    expect(board[1].cells[0].slot).toBe(12) // R2 reversed
    expect(board[1].cells[11].slot).toBe(1)
  })

  it('every slot appears exactly once per round', () => {
    for (const kind of ['snake', 'linear'] as const) {
      const board = buildDraftBoard({ rounds: 5, teamCount: 18, kind, thirdRoundReversal: kind === 'snake' })
      for (const row of board) {
        const slots = row.cells.map((c) => c.slot).sort((a, b) => a - b)
        expect(slots).toEqual(Array.from({ length: 18 }, (_, i) => i + 1))
      }
    }
  })

  it('a manager holds one pick per round, found by slot', () => {
    const board = buildDraftBoard({ rounds: 4, teamCount: 12, kind: 'snake' })
    const mine = board.map((row) => cellForSlot(row, 4)!)
    expect(mine.map((c) => c.label)).toEqual(['1.04', '2.09', '3.04', '4.09'])
  })

  it('linear gives a manager the same column every round', () => {
    const board = buildDraftBoard({ rounds: 4, teamCount: 12, kind: 'linear' })
    const mine = board.map((row) => cellForSlot(row, 4)!)
    expect(mine.map((c) => c.column)).toEqual([4, 4, 4, 4])
  })

  it('handles an 18-team board, which is where the scroll case lives', () => {
    const board = buildDraftBoard({ rounds: 2, teamCount: 18, kind: 'snake' })
    expect(board[0].cells).toHaveLength(18)
    expect(board[1].cells[0].slot).toBe(18)
    expect(board[1].cells[17].overall).toBe(36)
  })

  it('returns nothing rather than a broken grid for degenerate input', () => {
    expect(buildDraftBoard({ rounds: 0, teamCount: 12, kind: 'snake' })).toEqual([])
    expect(buildDraftBoard({ rounds: 5, teamCount: 0, kind: 'snake' })).toEqual([])
    expect(buildDraftBoard({ rounds: -3, teamCount: 12, kind: 'snake' })).toEqual([])
  })

  it('cellForSlot returns null for a slot outside the league', () => {
    const board = buildDraftBoard({ rounds: 1, teamCount: 12, kind: 'snake' })
    expect(cellForSlot(board[0], 99)).toBeNull()
  })
})

describe('parity with the three implementations it replaces', () => {
  // The exact predicates previously inlined in DraftBoard.tsx, DraftOrderService.ts and
  // KeeperDraftOrder.ts. If this ever diverges, the board and the order service disagree
  // about who owns a pick — invisible until it lands on the wrong manager.
  const legacy = (round: number, trr: boolean) =>
    trr ? round === 2 || round === 3 || (round >= 4 && round % 2 === 1) : round % 2 === 0

  it('matches for snake across 30 rounds, with and without 3RR', () => {
    for (const trr of [false, true]) {
      for (let round = 1; round <= 30; round++) {
        expect(isRoundReversed({ round, kind: 'snake', thirdRoundReversal: trr })).toBe(legacy(round, trr))
      }
    }
  })
})
