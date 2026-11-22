/** Draft as me: a missed pick is made the way the manager drafts, not plain best available. */
import { describe, expect, it } from 'vitest'
import { buildDraftStyle, MIN_STYLE_SAMPLE, pickLikeManager, type StylePick } from '@/lib/draft-room/draftAsMe'

const picks = (n: number, delta: number, position: string | ((i: number) => string)): StylePick[] =>
  Array.from({ length: n }, (_, i) => ({ overall: 20 + i * 12, adpAtPick: 20 + i * 12 - delta, position: typeof position === 'string' ? position : position(i) }))

const board = [
  { playerName: 'RB at 30', position: 'RB', adp: 30 },
  { playerName: 'WR at 31', position: 'WR', adp: 31 },
  { playerName: 'QB at 33', position: 'QB', adp: 33 },
  { playerName: 'WR at 38', position: 'WR', adp: 38 },
  { playerName: 'TE at 42', position: 'TE', adp: 42 },
  { playerName: 'RB at 45', position: 'RB', adp: 45 },
  { playerName: 'No ADP', position: 'RB', adp: null },
]

describe('buildDraftStyle', () => {
  it('needs enough history, and never guesses below it', () => {
    expect(buildDraftStyle(picks(MIN_STYLE_SAMPLE - 1, 0, 'RB'))).toBeNull()
    expect(buildDraftStyle(picks(MIN_STYLE_SAMPLE, 0, 'RB'))).not.toBeNull()
  })

  it('reads reach and position habits', () => {
    const style = buildDraftStyle(picks(12, -8, (i) => (i % 3 === 0 ? 'QB' : 'WR')))!
    expect(style.reachDelta).toBe(-8)
    expect(style.positionShare.QB).toBeCloseTo(4 / 12)
    expect(style.positionShare.WR).toBeCloseTo(8 / 12)
  })
})

describe('pickLikeManager', () => {
  it('a reacher takes a player later than the board says, a value hunter waits', () => {
    const mixed = (i: number) => ['RB', 'WR', 'QB', 'TE'][i % 4]!
    const reacher = buildDraftStyle(picks(12, -12, mixed))!
    const patient = buildDraftStyle(picks(12, 0, mixed))!
    expect(pickLikeManager({ style: patient, overall: 30, board, ownPositions: [] })!.player.playerName).toBe('RB at 30')
    // overall 30, reaching 12 picks early on average → targets players with ADP ≈ 42.
    expect(pickLikeManager({ style: reacher, overall: 30, board, ownPositions: [] })!.player.playerName).toBe('TE at 42')
  })

  it('leans to the positions the manager spends picks on', () => {
    const wrLover = buildDraftStyle(picks(12, 0, 'WR'))!
    expect(pickLikeManager({ style: wrLover, overall: 30, board, ownPositions: [] })!.player.position).toBe('WR')
  })

  it('passes over a position already held beyond the habit', () => {
    const halfWr = buildDraftStyle(picks(12, 0, (i) => (i < 6 ? 'WR' : 'RB')))!
    // At pick 31 the WR at 31 is the obvious choice for this manager…
    expect(pickLikeManager({ style: halfWr, overall: 31, board, ownPositions: ['WR'] })!.player.playerName).toBe('WR at 31')
    // …until they already hold more WRs than their habit (half their picks) allows.
    expect(pickLikeManager({ style: halfWr, overall: 31, board, ownPositions: ['WR', 'WR', 'WR'] })!.player.position).not.toBe('WR')
  })

  it('only considers positions the roster can use, and gives up on a board without ADP', () => {
    const style = buildDraftStyle(picks(12, 0, 'QB'))!
    expect(pickLikeManager({ style, overall: 30, board, ownPositions: [], eligible: new Set(['RB', 'WR']) })!.player.position).not.toBe('QB')
    expect(pickLikeManager({ style, overall: 30, board: board.map((p) => ({ ...p, adp: null })), ownPositions: [] })).toBeNull()
  })

  it('never reaches past the cap, however wild the history', () => {
    const wild = buildDraftStyle(Array.from({ length: 12 }, (_, i) => ({ overall: 10 + i, adpAtPick: 50 + i, position: 'RB' })))!
    expect(wild.reachDelta).toBe(-40)
    expect(pickLikeManager({ style: wild, overall: 30, board, ownPositions: [] })!.targetAdp).toBe(48)
  })
})
