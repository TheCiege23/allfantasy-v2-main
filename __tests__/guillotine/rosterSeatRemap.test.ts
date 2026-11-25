import { describe, expect, it } from 'vitest'
import { remapStarterSeats, seatMoves } from '@/lib/guillotine/rosterSeatRemap'
import { getAllNflSlots } from '@/lib/nfl-roster/NflRosterTemplates'
import { getAllNcaafSlots } from '@/lib/ncaaf-roster/NcaafRosterTemplates'
import { getAllNbaSlots } from '@/lib/nba-roster/NbaRosterTemplates'
import { getAllNcaabSlots } from '@/lib/ncaab-roster/NcaabRosterTemplates'
import { getAllMlbSlots } from '@/lib/mlb-roster/MlbRosterTemplates'
import { getAllNhlSlots } from '@/lib/nhl-roster/NhlRosterTemplates'
import { getAllSoccerSlots } from '@/lib/soccer-roster/SoccerRosterTemplates'

const BEFORE = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'K', 'DEF']

describe('where each seat goes when the layout gains a spot', () => {
  it('a Super Flex added before the kicker moves the kicker and the defense down one', () => {
    const after = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DEF']
    expect(seatMoves(BEFORE, after)).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 9])
  })

  it('a third receiver keeps WR1 and WR2 and moves everything after them', () => {
    const after = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'WR3', 'TE', 'FLEX', 'K', 'DEF']
    expect(seatMoves(BEFORE, after)).toEqual([0, 1, 2, 3, 4, 6, 7, 8, 9])
  })

  it('a lone Flex is the first Flex once there are two', () => {
    const after = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX1', 'FLEX2', 'K', 'DEF']
    expect(seatMoves(BEFORE, after)).toEqual([0, 1, 2, 3, 4, 5, 6, 8, 9])
  })

  it('a seat that no longer exists has nowhere to go', () => {
    expect(seatMoves(['QB', 'FLEX', 'K'], ['QB', 'K'])).toEqual([0, null, 1])
  })

  it('nothing moves when the layout is the same', () => {
    expect(seatMoves(BEFORE, BEFORE)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })
})

describe('a saved lineup after the change', () => {
  const after = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DEF']
  const lineup = () => ({
    players: ['qb', 'k', 'def', 'bn'],
    starters: ['qb', 'k', 'def'],
    lineup_sections: {
      starters: [
        { id: 'qb', position: 'QB', slotIndex: 0 },
        { id: 'k', position: 'K', slotIndex: 7 },
        { id: 'def', position: 'DEF', slotIndex: 8 },
      ],
      bench: [{ id: 'bn', position: 'WR' }],
    },
  })

  it('the kicker stays in the kicker seat and the defense in the defense seat', () => {
    const next = remapStarterSeats(lineup(), BEFORE, after) as ReturnType<typeof lineup>
    expect(next.lineup_sections.starters).toEqual([
      { id: 'qb', position: 'QB', slotIndex: 0 },
      { id: 'k', position: 'K', slotIndex: 8 },
      { id: 'def', position: 'DEF', slotIndex: 9 },
    ])
  })

  it('touches nothing but the seat numbers: same starters, same order, same bench', () => {
    const before = lineup()
    const next = remapStarterSeats(before, BEFORE, after) as ReturnType<typeof lineup>
    expect(next.players).toEqual(before.players)
    expect(next.starters).toEqual(before.starters)
    expect(next.lineup_sections.bench).toEqual(before.lineup_sections.bench)
    expect(next.lineup_sections.starters.map((r) => r.id)).toEqual(['qb', 'k', 'def'])
    // The input is not mutated.
    expect(before.lineup_sections.starters[1]).toEqual({ id: 'k', position: 'K', slotIndex: 7 })
  })

  it('returns the same object when no seat moves, so the caller can skip the write', () => {
    const only = { lineup_sections: { starters: [{ id: 'qb', position: 'QB', slotIndex: 0 }] } }
    expect(remapStarterSeats(only, BEFORE, after)).toBe(only)
    const same = lineup()
    expect(remapStarterSeats(same, BEFORE, BEFORE)).toBe(same)
  })

  it('a starter with no saved seat is left for the screen to seat', () => {
    const data = { lineup_sections: { starters: [{ id: 'k', position: 'K' }, { id: 'def', position: 'DEF', slotIndex: 8 }] } }
    const next = remapStarterSeats(data, BEFORE, after) as typeof data
    expect(next.lineup_sections.starters).toEqual([{ id: 'k', position: 'K' }, { id: 'def', position: 'DEF', slotIndex: 9 }])
  })

  it('a seat number that names no seat is dropped, never guessed', () => {
    const data = { lineup_sections: { starters: [{ id: 'x', position: 'K', slotIndex: 40 }] } }
    const next = remapStarterSeats(data, BEFORE, after) as typeof data
    expect(next.lineup_sections.starters).toEqual([{ id: 'x', position: 'K' }])
  })

  it('reads a legacy roster with no lineup sections as nothing to do', () => {
    for (const legacy of [null, ['a', 'b'], { players: ['a'] }, { lineup_sections: null }, { lineup_sections: { starters: 'x' } }]) {
      expect(remapStarterSeats(legacy, BEFORE, after)).toBe(legacy)
    }
  })
})

describe('the assumption the seat names rest on', () => {
  it('no roster slot key in any sport ends in a digit', () => {
    // A seat is read as its slot plus a number ("RB2"). A slot key ending in a digit would be misread.
    // The seven sports the roster engine registers (lib/roster-engine/RosterEngineRegistry.ts).
    for (const slots of [getAllNflSlots, getAllNcaafSlots, getAllNbaSlots, getAllNcaabSlots, getAllMlbSlots, getAllNhlSlots, getAllSoccerSlots]) {
      const keys = slots().map((s) => s.key)
      expect(keys.length).toBeGreaterThan(0)
      expect(keys.filter((k) => /\d$/.test(k))).toEqual([])
    }
  })
})
