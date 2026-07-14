import { describe, expect, it } from 'vitest'
import {
  countBenchSlots,
  countStarterSlots,
  countTaxiSlotsFromPositions,
  expandRosterPositionTokens,
  isBenchToken,
  isIrToken,
  isSuperflexToken,
  isTaxiToken,
} from '@/lib/trade-engine/rosterPositionFormat'

describe('expandRosterPositionTokens', () => {
  it('passes Sleeper-style flat tokens through unchanged (no-op)', () => {
    const raw = ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'SUPER_FLEX', 'BN', 'BN']
    expect(expandRosterPositionTokens(raw)).toEqual(raw)
  })

  it('expands ESPN-style "SLOT:COUNT" pairs into repeated flat tokens', () => {
    const raw = ['QB:1', 'RB:2', 'FLEX:2', 'SUPER_FLEX:1', 'BE:6', 'IR:2']
    const expanded = expandRosterPositionTokens(raw)
    expect(expanded).toEqual([
      'QB', 'RB', 'RB', 'FLEX', 'FLEX', 'SUPER_FLEX', 'BE', 'BE', 'BE', 'BE', 'BE', 'BE', 'IR', 'IR',
    ])
  })

  it('expands Yahoo-style "SLOT:COUNT" pairs identically', () => {
    const raw = ['QB:1', 'WR:3', 'BN:5']
    expect(expandRosterPositionTokens(raw)).toEqual(['QB', 'WR', 'WR', 'WR', 'BN', 'BN', 'BN', 'BN', 'BN'])
  })

  it('falls back to treating an unparseable count as a single flat token', () => {
    expect(expandRosterPositionTokens(['WEIRD:NOTANUMBER'])).toEqual(['WEIRD:NOTANUMBER'])
  })

  it('drops empty/blank entries', () => {
    expect(expandRosterPositionTokens(['QB', '', '  '])).toEqual(['QB'])
  })

  it('uppercases every token regardless of input casing', () => {
    expect(expandRosterPositionTokens(['qb', 'rb:2'])).toEqual(['QB', 'RB', 'RB'])
  })
})

describe('token classification', () => {
  it('recognizes SUPER_FLEX and SF as superflex tokens', () => {
    expect(isSuperflexToken('SUPER_FLEX')).toBe(true)
    expect(isSuperflexToken('SF')).toBe(true)
    expect(isSuperflexToken('FLEX')).toBe(false)
  })

  it('recognizes both BN (Sleeper/Yahoo) and BE (ESPN) as bench tokens', () => {
    expect(isBenchToken('BN')).toBe(true)
    expect(isBenchToken('BE')).toBe(true)
    expect(isBenchToken('QB')).toBe(false)
  })

  it('recognizes IR and IL as reserve tokens', () => {
    expect(isIrToken('IR')).toBe(true)
    expect(isIrToken('IL')).toBe(true)
  })

  it('recognizes TAXI/TX as taxi tokens', () => {
    expect(isTaxiToken('TAXI')).toBe(true)
    expect(isTaxiToken('TX')).toBe(true)
  })
})

describe('slot counting', () => {
  it('counts starter slots as everything except bench/IR, matching the original Sleeper-only logic', () => {
    const expanded = expandRosterPositionTokens(['QB', 'RB', 'RB', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'IR'])
    expect(countStarterSlots(expanded)).toBe(5) // QB, RB, RB, FLEX, SUPER_FLEX
    expect(countBenchSlots(expanded)).toBe(2)
  })

  it('produces identical starter/bench counts for equivalent Sleeper and ESPN-format rosters', () => {
    const sleeperStyle = expandRosterPositionTokens(['QB', 'RB', 'RB', 'FLEX', 'FLEX', 'SUPER_FLEX', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN', 'IR', 'IR'])
    const espnStyle = expandRosterPositionTokens(['QB:1', 'RB:2', 'FLEX:2', 'SUPER_FLEX:1', 'BE:6', 'IR:2'])
    expect(countStarterSlots(espnStyle)).toBe(countStarterSlots(sleeperStyle))
    expect(countBenchSlots(espnStyle)).toBe(countBenchSlots(sleeperStyle))
  })

  it('counts taxi slots when present as roster_positions tokens', () => {
    expect(countTaxiSlotsFromPositions(['TAXI', 'TAXI'])).toBe(2)
    expect(countTaxiSlotsFromPositions(expandRosterPositionTokens(['TAXI:3']))).toBe(3)
  })
})
