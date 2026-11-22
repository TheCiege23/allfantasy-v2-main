import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { assignLineupToSlots, expandSlotCountTemplate, startingSlotTemplate } from '@/lib/core-app/rosterSlots'
import { parseEspnRosterEntriesForTest } from '@/lib/league-import/espn/EspnLeagueFetchService'

/*
 * The Matchup board paired two ESPN lineups by index. Both are stored in ESPN's roster-array order,
 * so your WR met their QB. These pin the slot list the board now pairs against, and the placement
 * that puts each side's starters into it.
 */

/** As production stores it (EspnAdapter writes `${slot}:${count}` from lineupSlotCounts). */
const ESPN_SETTINGS = { roster_positions: ['QB:1', 'RB:2', 'WR:2', 'TE:1', 'D/ST:1', 'K:1', 'BE:7', 'IR:1', 'FLEX:1'] }
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF', 'K']

type P = { name: string; pos: string | null; slot?: string }
const place = (players: P[]) =>
  assignLineupToSlots(SLOTS, players, (p) => p.slot, (p) => p.pos, 'NFL')
const names = (r: { slots: Array<P | null> }) => r.slots.map((p) => p?.name ?? null)

describe('expandSlotCountTemplate', () => {
  it('expands ESPN SLOT:COUNT pairs into starting slots in reading order', () => {
    expect(expandSlotCountTemplate(ESPN_SETTINGS)).toEqual(SLOTS)
  })

  it('maps ESPN names and drops bench, IR and head coach', () => {
    expect(expandSlotCountTemplate({ rosterPositions: ['SUPER_FLEX:1', 'QB:1', 'HC:1', 'RB/WR:1', 'WR/TE:1', 'BE:6'] }))
      .toEqual(['QB', 'W/R', 'W/T', 'SFLEX'])
  })

  it('leaves a Sleeper template, a mixed list and an empty one alone', () => {
    expect(expandSlotCountTemplate({ roster_positions: ['QB', 'RB', 'FLEX', 'BN'] })).toBeNull()
    expect(expandSlotCountTemplate({ roster_positions: ['QB:1', 'RB'] })).toBeNull()
    expect(expandSlotCountTemplate({ roster_positions: [] })).toBeNull()
    expect(expandSlotCountTemplate(null)).toBeNull()
  })

  it('does not change startingSlotTemplate, which still refuses the shape', () => {
    expect(startingSlotTemplate(ESPN_SETTINGS)).toBeNull()
  })
})

describe('assignLineupToSlots', () => {
  // The lineup from the report, in the order the screen showed it.
  const reported: P[] = [
    { name: 'Chase', pos: 'WR' }, { name: 'Hall', pos: 'RB' }, { name: 'Williams', pos: 'WR' },
    { name: 'LaPorta', pos: 'TE' }, { name: 'Purdy', pos: 'QB' }, { name: 'Kraft', pos: 'TE' },
    { name: 'Allen', pos: 'RB' }, { name: 'Bass', pos: 'K' }, { name: 'BUF', pos: 'D/ST' },
  ]

  it('places the reported lineup with positions alone', () => {
    const r = place(reported)
    expect(names(r)).toEqual(['Purdy', 'Hall', 'Allen', 'Chase', 'Williams', 'LaPorta', 'Kraft', 'BUF', 'Bass'])
    expect(r.extra).toEqual([])
  })

  it('uses the provider\'s stored slot first, so the real FLEX is named', () => {
    const stored = reported.map((p) => ({ ...p, slot: p.name === 'LaPorta' ? 'FLEX' : p.pos === 'D/ST' ? 'D/ST' : p.pos ?? undefined }))
    expect(names(place(stored))).toEqual(['Purdy', 'Hall', 'Allen', 'Chase', 'Williams', 'Kraft', 'LaPorta', 'BUF', 'Bass'])
  })

  it('fills same-position slots before the FLEX, so two sides that flex differently still pair by slot', () => {
    const opponent: P[] = [
      { name: 'R1', pos: 'RB' }, { name: 'R2', pos: 'RB' }, { name: 'R3', pos: 'RB' }, { name: 'Q', pos: 'QB' },
      { name: 'W1', pos: 'WR' }, { name: 'W2', pos: 'WR' }, { name: 'T', pos: 'TE' }, { name: 'K', pos: 'K' }, { name: 'D', pos: 'DEF' },
    ]
    expect(names(place(opponent))).toEqual(['Q', 'R1', 'R2', 'W1', 'W2', 'T', 'R3', 'D', 'K'])
  })

  it('gives a position its own slot before a FLEX listed ahead of it', () => {
    const r = assignLineupToSlots(['FLEX', 'RB'], [{ name: 'Run', pos: 'RB' }, { name: 'Tight', pos: 'TE' }] as P[], () => null, (p) => p.pos, 'NFL')
    expect(r.slots.map((p) => p?.name)).toEqual(['Tight', 'Run'])
    expect(r.extra).toEqual([])
  })

  it('keeps an empty or unidentified starter in a free slot and returns anyone left over', () => {
    const r = place([
      { name: 'Q', pos: 'QB' }, { name: 'Q2', pos: 'QB' }, { name: 'empty', pos: null }, { name: 'Kick', pos: 'K' },
    ])
    expect(r.slots[0]?.name).toBe('Q')
    expect(r.slots[8]?.name).toBe('Kick')
    expect(r.slots.filter(Boolean).map((p) => p!.name)).toContain('empty')
    // A second QB is eligible for no slot in this league: shown as extra, never dropped.
    expect(r.extra.map((p) => p.name)).toEqual(['Q2'])
  })

  it('places the committed real-league capture by its stored ESPN slots', () => {
    const fixture = JSON.parse(
      readFileSync(join(process.cwd(), 'contracts/espn/fixtures/fantasy-league.NFL.2026.json'), 'utf8'),
    ) as { teams: Array<{ roster: { entries: unknown[] } }> }
    const parsed = parseEspnRosterEntriesForTest(fixture.teams[0].roster.entries)
    const r = assignLineupToSlots(SLOTS, parsed.starterIds, (id) => parsed.starterSlotById[id], () => null, 'NFL')
    expect(r.extra).toEqual([])
    expect(r.slots.every((id) => id !== null)).toBe(true)
    expect(r.slots[SLOTS.indexOf('FLEX')]).toBe('4696981')
    expect(r.slots.map((id) => parsed.starterSlotById[id!])).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'D/ST', 'K'])
  })
})
