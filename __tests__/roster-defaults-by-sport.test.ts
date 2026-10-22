import { describe, expect, it } from 'vitest'
import { getRosterTemplateDefinition } from '@/lib/roster-defaults/RosterDefaultsRegistry'
import { getPositionsForSport } from '@/lib/roster-defaults/PositionEligibilityResolver'

describe('Default Roster Settings by Sport', () => {
  it('defines NFL expected starter/flex/bench/IR slots', () => {
    const nfl = getRosterTemplateDefinition('NFL')
    const slotNames = nfl.slots.map((s) => s.slotName)

    expect(slotNames).toEqual(
      expect.arrayContaining(['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST', 'BENCH', 'IR'])
    )
    expect(nfl.slots.find((s) => s.slotName === 'RB')?.count).toBe(2)
    expect(nfl.totalStarterSlots).toBe(9)
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
      expect.arrayContaining(['SP', 'RP', 'P', 'C', '1B', '2B', '3B', 'SS', 'CI', 'MI', 'OF', 'UTIL', 'BENCH'])
    )
    // No DH starter: a DH-only hitter fills UTIL (lib/sportConfig/dailySportRedraftRoster.ts).
    expect(slotNames).not.toContain('DH')
    expect(mlb.totalBenchSlots).toBeGreaterThan(0)
  })

  it('defines NHL expected skater/goalie/utility roster shape', () => {
    const nhl = getRosterTemplateDefinition('NHL')
    const slotNames = nhl.slots.map((s) => s.slotName)

    expect(slotNames).toEqual(expect.arrayContaining(['C', 'LW', 'RW', 'D', 'G', 'UTIL', 'BENCH']))
    expect(nhl.totalBenchSlots).toBeGreaterThan(0)
  })

  it('defines NCAAF expected football roster shape (FLEX + K, no team defense, no default superflex)', () => {
    const ncaaf = getRosterTemplateDefinition('NCAAF')
    const slotNames = ncaaf.slots.map((s) => s.slotName)

    expect(slotNames).toEqual(
      expect.arrayContaining(['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'BENCH'])
    )
    expect(ncaaf.slots.find((s) => s.slotName === 'RB')?.count).toBe(2)
    // No college team defense exists to draft (redraftTeamDefenseEnabled), and superflex has been
    // opt-in for NCAAF since 595959f64 — neither is in the default template.
    expect(slotNames).not.toContain('DST')
    expect(slotNames).not.toContain('DEF')
    expect(slotNames).not.toContain('SUPERFLEX')
    expect(ncaaf.totalBenchSlots).toBeGreaterThan(0)
  })

  it('defines NCAAB expected G/F/C/UTIL roster shape', () => {
    const ncaab = getRosterTemplateDefinition('NCAAB')
    const slotNames = ncaab.slots.map((s) => s.slotName)

    expect(slotNames).toEqual(expect.arrayContaining(['G', 'F', 'C', 'UTIL', 'BENCH']))
    expect(ncaab.totalBenchSlots).toBeGreaterThan(0)
  })

  it('returns sport-aware positions for draft room filtering', () => {
    expect(getPositionsForSport('NFL')).toEqual(expect.arrayContaining(['QB', 'RB', 'WR', 'TE', 'K', 'DST']))
    expect(getPositionsForSport('NBA')).toEqual(expect.arrayContaining(['PG', 'SG', 'SF', 'PF', 'C']))
    expect(getPositionsForSport('MLB')).toEqual(expect.arrayContaining(['SP', 'RP', 'OF', 'C']))
    expect(getPositionsForSport('NHL')).toEqual(expect.arrayContaining(['C', 'LW', 'RW', 'D', 'G']))
    expect(getPositionsForSport('NCAAF')).toEqual(expect.arrayContaining(['QB', 'RB', 'WR', 'TE']))
    expect(getPositionsForSport('NCAAB')).toEqual(expect.arrayContaining(['G', 'F', 'C']))
  })
})
