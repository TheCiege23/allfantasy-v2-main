/**
 * Draft like me weighs what the roster still needs (2026-11-22). In a live draft it took RB, RB on
 * back-to-back picks: the style tilted toward RB and nothing said the team already had one with a
 * WR spot open. Need now breaks that call; habit still leans the pick.
 */
import { describe, expect, it } from 'vitest'
import { buildDraftStyle, filledNeedLabel, pickLikeManager, rosterNeedScore, type OpenStarterSlot, type StylePick } from '@/lib/draft-room/draftAsMe'

// A manager whose history is half RBs, drafting close to ADP.
const rbLean: StylePick[] = Array.from({ length: 12 }, (_, i) => ({ overall: 10 + i * 10, adpAtPick: 10 + i * 10, position: i % 2 ? 'RB' : i % 4 ? 'WR' : 'QB' }))
const style = buildDraftStyle(rbLean)!

// Pick 9: an RB just ahead of a WR on the board.
const board = [
  { playerName: 'Jonathan Taylor', position: 'RB', adp: 12.9 },
  { playerName: 'CeeDee Lamb', position: 'WR', adp: 12.2 },
  { playerName: 'Amon-Ra St. Brown', position: 'WR', adp: 9.9 },
  { playerName: 'Josh Allen', position: 'QB', adp: 19 },
  { playerName: 'Brock Bowers', position: 'TE', adp: 21 },
]

// 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX — after one RB is drafted.
const slots = (rbLeft: number, wrLeft: number): OpenStarterSlot[] => [
  { slotName: 'QB', allowedPositions: ['QB'], count: 1 },
  { slotName: 'RB', allowedPositions: ['RB'], count: rbLeft },
  { slotName: 'WR', allowedPositions: ['WR'], count: wrLeft },
  { slotName: 'TE', allowedPositions: ['TE'], count: 1 },
  { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'], count: 1 },
].filter((s) => s.count > 0)

describe('rosterNeedScore', () => {
  it('a slot only that position fills beats a flex slot, and a filled position with other needs left is a minus', () => {
    expect(rosterNeedScore('WR', slots(1, 2))).toBe(0.6)
    expect(rosterNeedScore('RB', slots(0, 2))).toBe(0.3)
    expect(rosterNeedScore('K', slots(0, 2))).toBe(-0.5)
    expect(rosterNeedScore('RB', [])).toBe(0)
    expect(rosterNeedScore('RB', null)).toBe(0)
  })

  it('names the need in words', () => {
    expect(filledNeedLabel('WR', slots(1, 2))).toBe('a WR')
    expect(filledNeedLabel('RB', slots(1, 2))).toBe('an RB')
    expect(filledNeedLabel('RB', slots(0, 2))).toBeNull()
  })
})

describe('pickLikeManager with roster need', () => {
  it('with both RB spots already filled and two WR spots open, a second RB habit gives way to a WR', () => {
    const own = ['RB', 'RB']
    const withNeed = pickLikeManager({ style, overall: 9, board, ownPositions: own, openStarters: slots(0, 2) })!
    expect(withNeed.player.position).toBe('WR')
  })

  it('without a template (no open slots passed) the pick is exactly what it was', () => {
    const own = ['RB']
    const before = pickLikeManager({ style, overall: 9, board, ownPositions: own })!
    const empty = pickLikeManager({ style, overall: 9, board, ownPositions: own, openStarters: [] })!
    expect(empty.player.playerName).toBe(before.player.playerName)
  })

  it('need breaks a near tie but never drags the pick far down the board', () => {
    const own = ['RB', 'RB', 'WR', 'WR']
    // Only TE and QB starters open: a TE at 21 or QB at 19 against a WR at 9.9 at pick 9.
    const open: OpenStarterSlot[] = [{ slotName: 'QB', allowedPositions: ['QB'], count: 1 }, { slotName: 'TE', allowedPositions: ['TE'], count: 1 }]
    const pick = pickLikeManager({ style, overall: 9, board, ownPositions: own, openStarters: open })!
    expect(['QB', 'TE', 'WR']).toContain(pick.player.position)
  })
})
