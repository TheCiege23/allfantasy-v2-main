import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { orderStartingSlots, storedStarterSlotLabels } from '@/lib/core-app/rosterSlots'
import { inferSlotLabel } from '@/lib/core-app/positionLabels'
import { parseEspnRosterEntriesForTest } from '@/lib/league-import/espn/EspnLeagueFetchService'
import { withTeamDefenseIds } from '@/lib/core-app/rosterIdCrosswalk'

/*
 * An ESPN My Team rendered its starters in the provider's roster-array order (a WR first, the QB
 * fifth), named a FLEX tight end "TE", and put the D/ST under "SLOT 9" with no game. These pin the
 * three pieces that fix it, against the committed real-league capture rather than a hand-built one.
 */

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'contracts/espn/fixtures/fantasy-league.NFL.2026.json'), 'utf8'),
) as { teams: Array<{ roster: { entries: unknown[] } }> }

describe('ESPN roster parse keeps each starter\'s real slot', () => {
  const parsed = parseEspnRosterEntriesForTest(fixture.teams[0].roster.entries)

  it('labels every starter, keyed by player id, and never a bench or IR player', () => {
    expect(Object.keys(parsed.starterSlotById).sort()).toEqual([...parsed.starterIds].sort())
    expect(parsed.starterIds.map((id) => parsed.starterSlotById[id])).toEqual([
      'RB', 'RB', 'WR', 'FLEX', 'QB', 'WR', 'TE', 'K', 'D/ST',
    ])
  })

  it('reads in lineup order once the stored labels are applied', () => {
    const labels = storedStarterSlotLabels(parsed.starterSlotById, parsed.starterIds)
    expect(labels).not.toBeNull()
    const ordered = orderStartingSlots(parsed.starterIds.map((id, i) => ({ id, slotLabel: labels![i] })))
    expect(ordered.map((s) => s.slotLabel)).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF', 'K'])
    // The FLEX is the running back ESPN put there, not whichever RB sorted last.
    expect(ordered.find((s) => s.slotLabel === 'FLEX')?.id).toBe('4696981')
  })
})

describe('storedStarterSlotLabels', () => {
  it('maps ESPN vocabulary onto the eligibility table\'s', () => {
    expect(storedStarterSlotLabels({ a: 'D/ST', b: 'SUPER_FLEX', c: 'RB/WR', d: 'WR/TE', e: 'OP' }, ['a', 'b', 'c', 'd', 'e']))
      .toEqual(['DEF', 'SFLEX', 'W/R', 'W/T', 'SFLEX'])
  })

  it('is all-or-nothing: one starter without a label discards the map', () => {
    expect(storedStarterSlotLabels({ a: 'QB' }, ['a', 'b'])).toBeNull()
  })

  it('refuses bench, IR and unknown-slot labels', () => {
    expect(storedStarterSlotLabels({ a: 'BE' }, ['a'])).toBeNull()
    expect(storedStarterSlotLabels({ a: 'IR' }, ['a'])).toBeNull()
    expect(storedStarterSlotLabels({ a: 'SLOT_99' }, ['a'])).toBeNull()
  })

  it('returns null for a roster imported before the field existed', () => {
    expect(storedStarterSlotLabels(undefined, ['a'])).toBeNull()
    expect(storedStarterSlotLabels(['QB'], ['a'])).toBeNull()
  })
})

describe('orderStartingSlots', () => {
  it('re-orders the lineup from the report (no stored labels, positions inferred)', () => {
    // The order the screen showed it in: Chase, Hall, Williams, LaPorta, Purdy, Kraft, Allen, Bass, D/ST.
    const shown = ['WR', 'RB', 'WR', 'TE', 'QB', 'TE', 'RB', 'K', null].map((pos, i) => ({
      slotLabel: inferSlotLabel(pos, i),
    }))
    expect(orderStartingSlots(shown).map((s) => s.slotLabel)).toEqual([
      'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'TE', 'K', 'SLOT 9',
    ])
  })

  it('is stable within a label and leaves unknown labels last', () => {
    const out = orderStartingSlots([
      { slotLabel: 'XYZ', n: 1 }, { slotLabel: 'RB', n: 2 }, { slotLabel: 'SFLEX', n: 3 },
      { slotLabel: 'FLEX', n: 4 }, { slotLabel: 'RB', n: 5 }, { slotLabel: 'QB', n: 6 },
    ])
    expect(out.map((s) => s.n)).toEqual([6, 2, 5, 4, 3, 1])
  })
})

describe('ESPN D/ST ids reach the Sleeper-keyed lookup', () => {
  it('translates -16002 to BUF with no position or name on the row', () => {
    const map = withTeamDefenseIds('espn', new Map(), [{ playerId: '-16002' }, { playerId: '4040715' }])
    expect(map.get('-16002')).toBe('BUF')
    expect(map.has('4040715')).toBe(false)
  })

  it('does not invent a defence for a non-ESPN id with no row data', () => {
    expect(withTeamDefenseIds('fleaflicker', new Map(), [{ playerId: '2343' }]).size).toBe(0)
  })
})
