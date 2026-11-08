/**
 * A waiver add (`addPlayerToRosterData`) pushed the player onto `lineup_sections.bench` as a BARE ID,
 * where every other row is `{ id, … }`. The lineup writers read rows as objects, so the next rebuild
 * threw — `Cannot use 'in' operator to search for 'slotIndex' in <id>` — and in a dynasty league that
 * rebuild is the rookie draft's finalization: the draft completed, no rookie reached a roster, and
 * year 2 never started (dynasty simulation, 2026-11-08). Leagues already holding bare-id rows heal
 * when the rows are next written.
 */
import { describe, expect, it } from 'vitest'
import { addPlayerToRosterData, removePlayerFromRosterData } from '@/lib/waiver-wire/roster-utils'
import { buildPlayerDataFromSections } from '@/lib/roster/LineupTemplateValidation'

const playerData = () => ({
  players: ['qb1', 'rb1', 'wr9'],
  lineup_sections: {
    starters: [{ id: 'qb1', position: 'QB', slotIndex: 0 }, { id: 'rb1', position: 'RB', slotIndex: 1 }],
    bench: [{ id: 'wr9', position: 'WR' }],
    ir: [],
    taxi: [],
    devy: [],
  },
})

describe('a waiver add writes a bench ROW', () => {
  it('adds { id } to the bench, not the bare id', () => {
    const next = addPlayerToRosterData(playerData(), 'te7') as any
    expect(next.players).toContain('te7')
    expect(next.lineup_sections.bench).toEqual([{ id: 'wr9', position: 'WR' }, { id: 'te7' }])
    expect(next.lineup_sections.bench.every((r: unknown) => typeof r === 'object')).toBe(true)
  })

  it('a later drop removes that row again', () => {
    const added = addPlayerToRosterData(playerData(), 'te7')
    const dropped = removePlayerFromRosterData(added, 'te7') as any
    expect(dropped.players).not.toContain('te7')
    expect(dropped.lineup_sections.bench).toEqual([{ id: 'wr9', position: 'WR' }])
  })
})

describe('the lineup writer reads a bare-id row already stored', () => {
  it('rebuilds without throwing, keeping the player under his own id', () => {
    const stored = playerData() as any
    stored.lineup_sections.bench.push('te7') // what the old waiver helper left in live leagues
    stored.players.push('te7')
    const rebuilt = buildPlayerDataFromSections(stored, stored.lineup_sections) as any
    expect(rebuilt.players).toContain('te7')
    expect(rebuilt.players).not.toContain('undefined')
    expect(rebuilt.lineup_sections.bench).toContainEqual({ id: 'te7' })
  })

  it('the waiver add then a rebuild — the path that broke the rookie draft', () => {
    const afterWaiver = addPlayerToRosterData(playerData(), 'te7') as any
    expect(() => buildPlayerDataFromSections(afterWaiver, afterWaiver.lineup_sections)).not.toThrow()
  })
})
