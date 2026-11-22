import { describe, expect, it } from 'vitest'

import { summarizeLineupChanges } from '@/lib/core-app/lineupChangeSummary'
import { messagesFor } from '@/lib/i18n/messages'
import { myTeamScreenMessages } from '@/lib/core-app/messages/myTeamScreen'

/**
 * 🛑 ONE MOVE READ AS THREE (live, 2026-11-06, an NFL Sleeper redraft league). The solver reported
 * a change per seat, so "start Warren, bench Wilson" printed as three rows with Golden struck out in
 * one and starting in another. The card now groups them: starts, benches, and seat moves.
 */
describe('summarizeLineupChanges', () => {
  it('turns the live three-seat chain into one start, one bench and two seat moves', () => {
    const out = summarizeLineupChanges([
      { slotIndex: 2, slotLabel: 'WR', outName: 'Michael Wilson', outProjected: 12.9, inName: 'Matthew Golden', inProjected: 14.9 },
      { slotIndex: 5, slotLabel: 'TE', outName: 'Sam LaPorta', outProjected: 13.4, inName: 'Tyler Warren', inProjected: 13.2 },
      { slotIndex: 6, slotLabel: 'FLEX', outName: 'Matthew Golden', outProjected: 14.9, inName: 'Sam LaPorta', inProjected: 13.4 },
    ])
    expect(out.starts).toEqual([{ name: 'Tyler Warren', projected: 13.2, slotLabel: 'TE', emptySeat: false }])
    expect(out.benches).toEqual([{ name: 'Michael Wilson', projected: 12.9 }])
    expect(out.moves).toEqual([
      { name: 'Matthew Golden', fromSlot: 'FLEX', toSlot: 'WR' },
      { name: 'Sam LaPorta', fromSlot: 'TE', toSlot: 'FLEX' },
    ])
  })

  it('a start into an empty seat benches nobody', () => {
    const out = summarizeLineupChanges([
      { slotIndex: 0, slotLabel: 'K', outName: null, outProjected: null, inName: 'Brandon Aubrey', inProjected: 9.1 },
    ])
    expect(out.starts).toEqual([{ name: 'Brandon Aubrey', projected: 9.1, slotLabel: 'K', emptySeat: true }])
    expect(out.benches).toEqual([])
    expect(out.moves).toEqual([])
  })
})

describe('the kicked-off footnote', () => {
  it('agrees with its number in English', () => {
    const m = messagesFor(myTeamScreenMessages, 'en')
    expect(m.optimizerLocked(1)).toBe('1 starter has kicked off and stays where he is.')
    expect(m.optimizerLocked(2)).toBe('2 starters have kicked off and stay where they are.')
  })
})
