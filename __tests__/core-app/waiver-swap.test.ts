// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { pickLineupSwap, rosterCapacity, swapReasoning, type SwapRosterPlayer } from '@/lib/core-app/waiverSwap'

/**
 * The cross-league Waivers board's decision, pinned to the audit finding that motivated it
 * (2026-10-02): ranked by "best free agent minus weakest bench", the board named a backup
 * quarterback as the top add in one-QB leagues while the league screen said nobody improved the
 * lineup. Each test can fail: the first goes red under the old rule.
 */

const ONE_QB = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']

const roster = (): SwapRosterPlayer[] => [
  { id: 'qb1', position: 'QB', points: 24 },
  { id: 'rb1', position: 'RB', points: 15 },
  { id: 'rb2', position: 'RB', points: 12 },
  { id: 'wr1', position: 'WR', points: 14 },
  { id: 'wr2', position: 'WR', points: 11 },
  { id: 'te1', position: 'TE', points: 8 },
  { id: 'fx1', position: 'WR', points: 7 },
  { id: 'bn1', position: 'RB', points: 3 },
  { id: 'bn2', position: 'WR', points: 5 },
]
const starters = new Set(['qb1', 'rb1', 'rb2', 'wr1', 'wr2', 'te1', 'fx1'])

describe('pickLineupSwap — ranked by what the add does to your starting lineup', () => {
  it('never takes the streaming QB a one-QB lineup would bench, however high he projects', () => {
    const swap = pickLineupSwap({
      roster: roster(),
      starterIds: starters,
      candidates: [
        { id: 'qbFA', position: 'QB', points: 18 }, // the old rule's pick: highest projection on the wire
        { id: 'wrFA', position: 'WR', points: 10 }, // starts over fx1 (7): +3
      ],
      slots: ONE_QB,
      dynasty: false,
    })
    expect(swap).toMatchObject({ addId: 'wrFA', gain: 3, displacesId: 'fx1' })
  })

  it('returns null when nobody on the wire would start — a finding, not a recommendation', () => {
    const swap = pickLineupSwap({
      roster: roster(),
      starterIds: starters,
      candidates: [{ id: 'qbFA', position: 'QB', points: 18 }],
      slots: ONE_QB,
      dynasty: false,
    })
    expect(swap).toBeNull()
  })

  it('redraft drops the lowest-projected bench player', () => {
    const swap = pickLineupSwap({
      roster: roster(),
      starterIds: starters,
      candidates: [{ id: 'wrFA', position: 'WR', points: 10 }],
      slots: ONE_QB,
      dynasty: false,
    })
    expect(swap).toMatchObject({ dropId: 'bn1', dropBasis: 'projection' })
  })

  it('dynasty drops the lowest MARKET value, not the rookie stash with the lowest projection', () => {
    const r = roster().map((p) =>
      p.id === 'bn1' ? { ...p, marketValue: 4200 } /* rookie stash: 3 pts, high value */ : p.id === 'bn2' ? { ...p, marketValue: 300 } : p,
    )
    const swap = pickLineupSwap({
      roster: r,
      starterIds: starters,
      candidates: [{ id: 'wrFA', position: 'WR', points: 10 }],
      slots: ONE_QB,
      dynasty: true,
    })
    expect(swap).toMatchObject({ dropId: 'bn2', dropBasis: 'market_value' })
  })

  it('never names an unpriced bench player as the drop — missing data is not a low number', () => {
    const r = roster().map((p) => (p.id === 'bn1' ? { ...p, points: null } : p))
    const swap = pickLineupSwap({
      roster: r,
      starterIds: starters,
      candidates: [{ id: 'wrFA', position: 'WR', points: 10 }],
      slots: ONE_QB,
      dynasty: false,
    })
    expect(swap?.dropId).toBe('bn2')
  })

  it('names no drop when the roster has an open spot', () => {
    const swap = pickLineupSwap({
      roster: roster(),
      starterIds: starters,
      candidates: [{ id: 'wrFA', position: 'WR', points: 10 }],
      slots: ONE_QB,
      dynasty: false,
      held: 9,
      capacity: 10,
    })
    expect(swap).toMatchObject({ dropId: null, openRosterSpot: true })
  })

  it('does not drop a bench player the new best lineup would start', () => {
    /*
     * bn2 (WR 5) is benched behind a declared FLEX starter at 2, so the solver seats him in FLEX.
     * The add is a quarterback, which leaves FLEX alone — bn2 is still in the best lineup, and is
     * still the lowest projection on the bench. Without the rule he would be the drop; the backup
     * QB (10, cannot start beside qbFA in a one-QB lineup) is the right one.
     */
    const r: SwapRosterPlayer[] = roster().map((p) =>
      p.id === 'fx1' ? { ...p, points: 2 } : p.id === 'bn1' ? { ...p, position: 'QB', points: 10 } : p,
    )
    const swap = pickLineupSwap({
      roster: r,
      starterIds: starters,
      candidates: [{ id: 'qbFA', position: 'QB', points: 30 }],
      slots: ONE_QB,
      dynasty: false,
    })
    expect(swap).toMatchObject({ addId: 'qbFA', gain: 6, displacesId: 'qb1' })
    expect(swap?.dropId).toBe('bn1')
  })
})

describe('rosterCapacity', () => {
  it('counts every slot but IR and taxi', () => {
    expect(rosterCapacity({ roster_positions: ['QB', 'RB', 'FLEX', 'BN', 'BN', 'IR'] })).toBe(5)
  })
  it('refuses NAME:count spellings rather than inventing open spots', () => {
    expect(rosterCapacity({ roster_positions: ['QB:1', 'BN:7'] })).toBeNull()
  })
  it('is null with no slots on file', () => {
    expect(rosterCapacity({})).toBeNull()
  })
})

describe('swapReasoning', () => {
  it('says who he starts over and who goes, without naming one player twice', () => {
    const text = swapReasoning({
      addLead: 'A (WR) projects 10.0',
      over: { name: 'B', projected: 7 },
      drop: { name: 'B', projected: 7 },
      dropBasis: 'projection',
      gain: 3,
      unit: '',
    })
    expect(text).toContain('would start over B (7.0) — +3.0 to your starting lineup.')
    expect(text).toContain('B is also your lowest-projected bench player, so is the drop.')
    expect(text).not.toContain('Drop B')
  })
})
