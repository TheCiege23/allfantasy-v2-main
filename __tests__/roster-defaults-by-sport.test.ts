import { describe, expect, it } from 'vitest'
import { getRosterTemplateDefinition } from '@/lib/roster-defaults/RosterDefaultsRegistry'
import { getPositionsForSport } from '@/lib/roster-defaults/PositionEligibilityResolver'

describe('Default Roster Settings by Sport', () => {
  it('defines NFL expected starter/flex/bench/IR slots', () => {
    const nfl = getRosterTemplateDefinition('NFL')
    const slotNames = nfl.slots.map((s) => s.slotName)

    expect(slotNames).toEqual(
      expect.arrayContaining(['QB', 'RB', 'WR', 'TE', 'DEF', 'BENCH', 'IR'])
    )
    expect(slotNames).not.toContain('DST')
    expect(nfl.totalBenchSlots).toBeGreaterThan(0)
    expect(nfl.totalIRSlots).toBeGreaterThan(0)
  })

  it('defines NBA expected guard/forward/utility roster shape', () => {
    const nba = getRosterTemplateDefinition('NBA')
    const slotNames = nba.slots.map((s) => s.slotName)

    expect(slotNames).toEqual(
      expect.arrayContaining(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'BENCH'])
    )
    expect(nba.totalBenchSlots).toBeGreaterThan(0)
  })

  it('defines MLB expected pitcher/infield/outfield/utility roster shape', () => {
    const mlb = getRosterTemplateDefinition('MLB')
    const slotNames = mlb.slots.map((s) => s.slotName)

    expect(slotNames).toEqual(
      expect.arrayContaining(['SP', 'RP', 'P', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'UTIL', 'BENCH'])
    )
    expect(mlb.totalBenchSlots).toBeGreaterThan(0)
  })

  it('defines NHL expected skater/goalie/utility roster shape', () => {
    const nhl = getRosterTemplateDefinition('NHL')
    const slotNames = nhl.slots.map((s) => s.slotName)

    expect(slotNames).toEqual(expect.arrayContaining(['C', 'LW', 'RW', 'D', 'G', 'UTIL', 'BENCH']))
    expect(nhl.totalBenchSlots).toBeGreaterThan(0)
  })

  it('defines NCAAF expected football roster shape with superflex', () => {
    const ncaaf = getRosterTemplateDefinition('NCAAF')
    const slotNames = ncaaf.slots.map((s) => s.slotName)

    expect(slotNames).toEqual(
      expect.arrayContaining(['QB', 'RB', 'WR', 'TE', 'DEF', 'BENCH', 'IR'])
    )
    expect(slotNames).not.toContain('DST')
    expect(ncaaf.totalBenchSlots).toBeGreaterThan(0)
  })

  it('defines NCAAB expected G/F/C/UTIL roster shape', () => {
    const ncaab = getRosterTemplateDefinition('NCAAB')
    const slotNames = ncaab.slots.map((s) => s.slotName)

    expect(slotNames).toEqual(expect.arrayContaining(['G', 'F', 'C', 'UTIL', 'BENCH']))
    expect(ncaab.totalBenchSlots).toBeGreaterThan(0)
  })

  it('returns sport-aware positions for draft room filtering', () => {
    expect(getPositionsForSport('NFL')).toEqual(expect.arrayContaining(['QB', 'RB', 'WR', 'TE', 'DEF']))
    expect(getPositionsForSport('NFL')).not.toContain('DST')
    expect(getPositionsForSport('NBA')).toEqual(expect.arrayContaining(['PG', 'SG', 'SF', 'PF', 'C']))
    expect(getPositionsForSport('MLB')).toEqual(expect.arrayContaining(['SP', 'RP', 'OF', 'C']))
    expect(getPositionsForSport('NHL')).toEqual(expect.arrayContaining(['C', 'LW', 'RW', 'D', 'G']))
    expect(getPositionsForSport('NCAAF')).toEqual(expect.arrayContaining(['QB', 'RB', 'WR', 'TE']))
    expect(getPositionsForSport('NCAAB')).toEqual(expect.arrayContaining(['G', 'F', 'C']))
  })
})
