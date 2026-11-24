import { describe, expect, it } from 'vitest'
import { computeBestLineupPPG, parseRosterSlots } from '@/lib/trade-engine/trade-engine'
import type { Asset } from '@/lib/trade-engine/types'

/**
 * Flex slots in the trade engine's lineup math (2026-11-23).
 *
 * 🛑 TWO WERE MAPPED WRONG, IN OPPOSITE DIRECTIONS. Sleeper's `REC_FLEX` (WR or TE) let a running back in,
 * and ESPN's `WR/TE` was read as WR/RB — a tight end could not fill it and a running back could. Only
 * `WRRB_FLEX` was right. The lineup value of any trade in such a league was computed for a lineup the
 * league does not allow.
 */

const eligible = (slot: string) => parseRosterSlots([slot])[0]?.eligiblePositions.slice().sort() ?? null

describe('parseRosterSlots', () => {
  it('a receiver flex takes WR and TE — never a running back — however the platform spells it', () => {
    for (const slot of ['REC_FLEX', 'WR/TE', 'W/T', 'rec_flex']) expect(eligible(slot), slot).toEqual(['TE', 'WR'])
  })

  it('an RB/WR flex takes RB and WR — never a tight end', () => {
    for (const slot of ['WRRB_FLEX', 'RB/WR', 'W/R']) expect(eligible(slot), slot).toEqual(['RB', 'WR'])
  })

  it('a full flex takes RB, WR and TE, and a superflex adds QB', () => {
    for (const slot of ['FLEX', 'W/R/T', 'RB/WR/TE']) expect(eligible(slot), slot).toEqual(['RB', 'TE', 'WR'])
    for (const slot of ['SUPER_FLEX', 'OP', 'Q/W/R/T']) expect(eligible(slot), slot).toEqual(['QB', 'RB', 'TE', 'WR'])
  })

  it('leaves out slots it does not price, as before (bench, kicker, defense)', () => {
    expect(parseRosterSlots(['BN', 'K', 'DEF', 'QB'])).toEqual([{ slot: 'QB', eligiblePositions: ['QB'] }])
  })
})

describe('computeBestLineupPPG with a receiver flex', () => {
  const player = (id: string, pos: string, value: number): Asset => ({ id, type: 'PLAYER', pos, value, marketValue: value, name: id }) as Asset

  it('a star running back cannot fill a WR/TE flex; the tight end does', () => {
    // One RB slot plus a receiver flex. The second RB is the better player, but a WR/TE flex cannot take
    // him — before the fix it did, and the lineup counted a starter the league would not allow.
    const roster = [player('rb1', 'RB', 9000), player('rb2', 'RB', 8500), player('te1', 'TE', 1000)]
    const withRecFlex = computeBestLineupPPG(roster, ['RB', 'REC_FLEX'])
    const withRbOnly = computeBestLineupPPG(roster.filter((p) => p.id !== 'rb2'), ['RB', 'REC_FLEX'])
    // The second RB adds nothing: he has no slot to fill.
    expect(withRecFlex).toBeCloseTo(withRbOnly, 6)
    // A full FLEX would have taken him.
    expect(computeBestLineupPPG(roster, ['RB', 'FLEX'])).toBeGreaterThan(withRecFlex)
  })

  it('a tight end can fill an ESPN WR/TE slot', () => {
    const te = [player('te1', 'TE', 4000)]
    expect(computeBestLineupPPG(te, ['WR/TE'])).toBeGreaterThan(0)
  })
})
