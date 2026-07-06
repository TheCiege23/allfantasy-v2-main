/**
 * Regression lock for a bug found during the NFL redraft Waivers UI rehearsal: a real free-agent
 * add through `/api/waiver-wire/leagues/[leagueId]/add-drop` updated the flat `players` array but
 * never touched `lineup_sections`, so the newly added player never appeared in the Roster tab's
 * Bench view (which renders from `getNormalizedLineupSections`, not the flat array) and a dropped
 * bench player stayed listed in `lineup_sections.bench` after being removed from `players`.
 * `addPlayerToRosterData`/`removePlayerFromRosterData` (lib/waiver-wire/roster-utils.ts) are the
 * shared writers used by free-agent add/drop, the waiver claim processor, the trade processor, and
 * the C2C/devy promotion services — so this kept every one of those write paths desynced.
 */
import { describe, expect, it } from 'vitest'
import { addPlayerToRosterData, removePlayerFromRosterData } from '@/lib/waiver-wire/roster-utils'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'

const playerData = {
  players: ['qb-1', 'rb-1', 'bench-1'],
  starters: ['qb-1', 'rb-1'],
  lineup_sections: {
    starters: [
      { id: 'qb-1', position: 'QB' },
      { id: 'rb-1', position: 'RB' },
    ],
    bench: [{ id: 'bench-1', position: 'WR' }],
    ir: [],
    taxi: [],
    devy: [],
  },
}

describe('addPlayerToRosterData/removePlayerFromRosterData keep lineup_sections in sync', () => {
  it('adds a new free agent to lineup_sections.bench, not just the flat players array', () => {
    const next = addPlayerToRosterData(playerData, 'fa-1') as typeof playerData
    expect((next as any).players).toContain('fa-1')
    const sections = getNormalizedLineupSections(next)
    expect(sections.bench.map((row: any) => row.id)).toContain('fa-1')
    expect(sections.starters.map((row: any) => row.id)).toEqual(['qb-1', 'rb-1'])
  })

  it('removes a dropped player from lineup_sections wherever it was, not just the flat players array', () => {
    const next = removePlayerFromRosterData(playerData, 'bench-1') as typeof playerData
    expect((next as any).players).not.toContain('bench-1')
    const sections = getNormalizedLineupSections(next)
    expect(sections.bench.map((row: any) => row.id)).not.toContain('bench-1')
  })

  it('leaves rosters with no lineup_sections block untouched (pre-draft/legacy shape)', () => {
    const legacy = { players: ['qb-1'], starters: ['qb-1'] }
    const next = addPlayerToRosterData(legacy, 'fa-1') as any
    expect(next.players).toEqual(['qb-1', 'fa-1'])
    expect(next.lineup_sections).toBeUndefined()
  })
})
