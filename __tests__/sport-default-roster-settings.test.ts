import { describe, expect, it } from 'vitest'
import { getRosterTemplateDefinition } from '@/lib/roster-defaults/RosterDefaultsRegistry'
import {
  getAllowedPositionsForSlot,
  isPositionEligibleForSlot,
  getPositionsForSport,
} from '@/lib/roster-defaults/PositionEligibilityResolver'
import { validateRoster } from '@/lib/roster-defaults/RosterValidationEngine'
import {
  getDefaultRosterSlotsForSport,
  getPositionFilterOptionsForSport,
} from '@/lib/draft-room/SportDraftUIResolver'
import { getPositionsForSport as getRegistryPositionsForSport } from '@/lib/multi-sport/SportRegistry'

describe('Default Roster Settings by Sport', () => {
  it('provides expected core roster slots for required sports', () => {
    const requiredSports = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB'] as const

    for (const sport of requiredSports) {
      const template = getRosterTemplateDefinition(sport)
      expect(template.sportType).toBe(sport)
      expect(template.totalStarterSlots).toBeGreaterThan(0)
      expect(template.totalBenchSlots).toBeGreaterThan(0)

      const slotNames = template.slots.map((s) => s.slotName)
      expect(slotNames.includes('BENCH')).toBe(true)

      if (sport === 'NFL') {
        for (const slot of ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST']) {
          expect(slotNames.includes(slot)).toBe(true)
        }
      }

      if (sport === 'NBA') {
        for (const slot of ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL']) {
          expect(slotNames.includes(slot)).toBe(true)
        }
      }

      if (sport === 'MLB') {
        for (const slot of ['SP', 'RP', 'P', 'C', '1B', '2B', '3B', 'SS', 'CI', 'MI', 'OF', 'UTIL']) {
          expect(slotNames.includes(slot)).toBe(true)
        }
      }

      if (sport === 'NHL') {
        for (const slot of ['C', 'LW', 'RW', 'D', 'G', 'UTIL']) {
          expect(slotNames.includes(slot)).toBe(true)
        }
      }

      if (sport === 'NCAAF') {
        for (const slot of ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K']) {
          expect(slotNames.includes(slot)).toBe(true)
        }
        // No college team defense exists to draft — see redraftTeamDefenseEnabled.
        expect(slotNames.includes('DST')).toBe(false)
      }

      if (sport === 'NCAAB') {
        for (const slot of ['G', 'F', 'C', 'UTIL']) {
          expect(slotNames.includes(slot)).toBe(true)
        }
      }
    }
  })

  it('applies sport-aware eligibility and soccer GK alias logic', () => {
    expect(isPositionEligibleForSlot('SOCCER', 'GKP', 'GK')).toBe(true)
    expect(isPositionEligibleForSlot('SOCCER', 'UTIL', 'GK')).toBe(true)
    expect(isPositionEligibleForSlot('SOCCER', 'BENCH', 'GK')).toBe(true)
    expect(isPositionEligibleForSlot('SOCCER', 'GKP', 'FWD')).toBe(false)

    const soccerPositions = getPositionsForSport('SOCCER')
    expect(soccerPositions).toEqual(expect.arrayContaining(['GKP', 'GK', 'DEF', 'MID', 'FWD']))

    const nflFlex = getAllowedPositionsForSlot('NFL', 'FLEX')
    expect(nflFlex).toEqual(expect.arrayContaining(['RB', 'WR', 'TE']))

    const mlbP = getAllowedPositionsForSlot('MLB', 'P')
    expect(mlbP).toEqual(expect.arrayContaining(['SP', 'RP']))
  })

  it('validates roster assignments against slot eligibility', () => {
    const valid = validateRoster('NFL', [
      { playerId: 'p1', position: 'QB', slotName: 'QB' },
      { playerId: 'p2', position: 'RB', slotName: 'RB' },
      { playerId: 'p3', position: 'WR', slotName: 'WR' },
      { playerId: 'p4', position: 'TE', slotName: 'FLEX' },
    ])
    expect(valid.valid).toBe(true)

    const invalid = validateRoster('NFL', [
      { playerId: 'p5', position: 'QB', slotName: 'WR' },
    ])
    expect(invalid.valid).toBe(false)
    expect(invalid.errors.some((e) => e.includes('not allowed'))).toBe(true)
  })

  it('keeps draft-room filters and fallback slots sport-aware', () => {
    const nflIdpOptions = getPositionFilterOptionsForSport('NFL', 'DYNASTY_IDP').map((o) => o.value)
    expect(nflIdpOptions).toEqual(
      expect.arrayContaining(['Offense', 'DL', 'LB', 'DB', 'IDP_FLEX'])
    )

    const ncaabFallback = getDefaultRosterSlotsForSport('NCAAB')
    expect(ncaabFallback).toEqual(
      expect.arrayContaining(['G', 'F', 'C', 'UTIL', 'BENCH'])
    )
    expect(ncaabFallback.includes('PG')).toBe(false)

    const ncaafPositions = getPositionsForSport('NCAAF')
    expect(ncaafPositions).toEqual(expect.arrayContaining(['QB', 'RB', 'WR', 'TE', 'K']))
    expect(ncaafPositions).not.toContain('DST')

    const nflDynastyIdpPositions = getRegistryPositionsForSport('NFL', 'DYNASTY_IDP')
    expect(nflDynastyIdpPositions).toEqual(expect.arrayContaining(['DE', 'DT', 'LB', 'CB', 'S']))
  })
})
