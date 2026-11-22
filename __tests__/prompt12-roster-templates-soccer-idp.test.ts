import { describe, expect, it, vi } from 'vitest'
import { getRosterTemplateDefinition, getSlotNamesForSport } from '@/lib/roster-defaults/RosterDefaultsRegistry'
import {
  getAllowedPositionsForSlot,
  isPositionEligibleForSlot,
  getPositionsForSport,
} from '@/lib/roster-defaults/PositionEligibilityResolver'
import { getRosterTemplate } from '@/lib/multi-sport/RosterTemplateService'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    rosterTemplate: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}))

describe('Prompt 12 — Default Roster Templates for Soccer + NFL IDP', () => {
  describe('Soccer Roster Template Definitions', () => {
    it('provides soccer roster with GKP, DEF, MID, FWD, UTIL, BENCH, IR', () => {
      const template = getRosterTemplateDefinition('SOCCER')
      const slotNames = template.slots.map((s) => s.slotName)

      expect(slotNames).toContain('GKP')
      expect(slotNames).toContain('DEF')
      expect(slotNames).toContain('MID')
      expect(slotNames).toContain('FWD')
      expect(slotNames).toContain('UTIL')
      expect(slotNames).toContain('BENCH')
      expect(slotNames).toContain('IR')

      const gkpSlot = template.slots.find((s) => s.slotName === 'GKP')
      expect(gkpSlot?.count).toBe(1)

      const defSlot = template.slots.find((s) => s.slotName === 'DEF')
      expect(defSlot?.count).toBe(4)

      const midSlot = template.slots.find((s) => s.slotName === 'MID')
      expect(midSlot?.count).toBe(4)

      const fwdSlot = template.slots.find((s) => s.slotName === 'FWD')
      expect(fwdSlot?.count).toBe(2)

      const utilSlot = template.slots.find((s) => s.slotName === 'UTIL')
      expect(utilSlot?.count).toBe(1)

      const benchSlot = template.slots.find((s) => s.slotName === 'BENCH')
      expect(benchSlot?.count).toBe(4)

      const irSlot = template.slots.find((s) => s.slotName === 'IR')
      expect(irSlot?.count).toBe(1)
    })

    it('soccer roster totalStarterSlots = 12 (1+4+4+2+1)', () => {
      const template = getRosterTemplateDefinition('SOCCER')
      expect(template.totalStarterSlots).toBe(12)
    })

    it('soccer roster totalBenchSlots = 4', () => {
      const template = getRosterTemplateDefinition('SOCCER')
      expect(template.totalBenchSlots).toBe(4)
    })

    it('soccer roster totalIRSlots = 1', () => {
      const template = getRosterTemplateDefinition('SOCCER')
      expect(template.totalIRSlots).toBe(1)
    })

    it('soccer UTIL slot is flexible and accepts all soccer positions', () => {
      const template = getRosterTemplateDefinition('SOCCER')
      const utilSlot = template.slots.find((s) => s.slotName === 'UTIL')

      expect(utilSlot?.isFlexibleSlot).toBe(true)
      expect(utilSlot?.allowedPositions).toEqual(expect.arrayContaining(['GKP', 'DEF', 'MID', 'FWD']))
    })

    it('soccer GKP slot only accepts GKP position (and GK alias)', () => {
      const template = getRosterTemplateDefinition('SOCCER')
      const gkpSlot = template.slots.find((s) => s.slotName === 'GKP')

      expect(gkpSlot?.allowedPositions).toContain('GKP')
    })
  })

  describe('Soccer Position Eligibility and Aliases', () => {
    it('GK position is eligible for GKP slot via alias', () => {
      expect(isPositionEligibleForSlot('SOCCER', 'GKP', 'GK')).toBe(true)
      expect(isPositionEligibleForSlot('SOCCER', 'GKP', 'GKP')).toBe(true)
    })

    it('GK position is eligible for UTIL slot via alias', () => {
      expect(isPositionEligibleForSlot('SOCCER', 'UTIL', 'GK')).toBe(true)
    })

    it('GK position is eligible for BENCH slot via alias', () => {
      expect(isPositionEligibleForSlot('SOCCER', 'BENCH', 'GK')).toBe(true)
    })

    it('FWD position is not eligible for GKP slot', () => {
      expect(isPositionEligibleForSlot('SOCCER', 'GKP', 'FWD')).toBe(false)
    })

    it('returns all soccer positions including GK and GKP aliases', () => {
      const positions = getPositionsForSport('SOCCER')
      expect(positions).toEqual(expect.arrayContaining(['GKP', 'GK', 'DEF', 'MID', 'FWD']))
    })

    it('allowed positions for UTIL slot include all soccer positions', () => {
      const allowed = getAllowedPositionsForSlot('SOCCER', 'UTIL')
      expect(allowed).toEqual(expect.arrayContaining(['GKP', 'GK', 'DEF', 'MID', 'FWD']))
    })
  })

  describe('Soccer Roster Template DTO', () => {
    it('generates valid RosterTemplateDto for soccer', async () => {
      const template = await getRosterTemplate('SOCCER', 'standard')

      expect(template.sportType).toBe('SOCCER')
      expect(template.formatType).toBe('standard')
      expect(template.name).toContain('SOCCER')
      expect(template.slots.length).toBeGreaterThan(0)

      const slotNames = template.slots.map((s) => s.slotName)
      expect(slotNames).toContain('GKP')
      expect(slotNames).toContain('DEF')
      expect(slotNames).toContain('BENCH')
      expect(slotNames).toContain('IR')
    })

    it('soccer slot order matches expected display order', async () => {
      const template = await getRosterTemplate('SOCCER', 'standard')

      const slotOrder = template.slots.map((s) => s.slotName)
      const starterEndIndex = slotOrder.indexOf('BENCH')
      const starters = slotOrder.slice(0, starterEndIndex)

      expect(starters).toContain('GKP')
      expect(starters.indexOf('GKP')).toBeLessThan(starters.indexOf('DEF'))
    })

    it('soccer slot allowed positions are correctly set', async () => {
      const template = await getRosterTemplate('SOCCER', 'standard')

      const utilSlot = template.slots.find((s) => s.slotName === 'UTIL')
      expect(utilSlot?.allowedPositions).toEqual(
        expect.arrayContaining(['GKP', 'DEF', 'MID', 'FWD'])
      )
      expect(utilSlot?.isFlexibleSlot).toBe(true)
    })
  })

  describe('NFL IDP Roster Template Definitions', () => {
    it('provides IDP roster with offensive + defensive positions', () => {
      const template = getRosterTemplateDefinition('NFL', 'IDP')
      const slotNames = template.slots.map((s) => s.slotName)

      // Offensive slots
      expect(slotNames).toContain('QB')
      expect(slotNames).toContain('RB')
      expect(slotNames).toContain('WR')
      expect(slotNames).toContain('TE')
      expect(slotNames).toContain('K')
      expect(slotNames).toContain('FLEX')

      // Defensive slots
      expect(slotNames).toContain('DE')
      expect(slotNames).toContain('DT')
      expect(slotNames).toContain('LB')
      expect(slotNames).toContain('CB')
      expect(slotNames).toContain('S')

      // Defensive flex slots
      expect(slotNames).toContain('DL')
      expect(slotNames).toContain('DB')
      expect(slotNames).toContain('IDP_FLEX')

      // Reserve slots
      expect(slotNames).toContain('BENCH')
      expect(slotNames).toContain('IR')
    })

    it('IDP defensive fixed slots all present (DE:2, DT:1, LB:2, CB:2, S:2)', () => {
      const template = getRosterTemplateDefinition('NFL', 'IDP')

      const deSlot = template.slots.find((s) => s.slotName === 'DE')
      expect(deSlot?.count).toBe(2)

      const dtSlot = template.slots.find((s) => s.slotName === 'DT')
      expect(dtSlot?.count).toBe(1)

      const lbSlot = template.slots.find((s) => s.slotName === 'LB')
      expect(lbSlot?.count).toBe(2)

      const cbSlot = template.slots.find((s) => s.slotName === 'CB')
      expect(cbSlot?.count).toBe(2)

      const sSlot = template.slots.find((s) => s.slotName === 'S')
      expect(sSlot?.count).toBe(2)
    })

    it('IDP defensive flex slots all present (DL:1, DB:1, IDP_FLEX:1)', () => {
      const template = getRosterTemplateDefinition('NFL', 'IDP')

      const dlSlot = template.slots.find((s) => s.slotName === 'DL')
      expect(dlSlot?.count).toBe(1)
      expect(dlSlot?.isFlexibleSlot).toBe(true)

      const dbSlot = template.slots.find((s) => s.slotName === 'DB')
      expect(dbSlot?.count).toBe(1)
      expect(dbSlot?.isFlexibleSlot).toBe(true)

      const idpFlexSlot = template.slots.find((s) => s.slotName === 'IDP_FLEX')
      expect(idpFlexSlot?.count).toBe(1)
      expect(idpFlexSlot?.isFlexibleSlot).toBe(true)
    })

    it('IDP offensive slots match base NFL (no DST)', () => {
      const template = getRosterTemplateDefinition('NFL', 'IDP')
      const slotNames = template.slots.map((s) => s.slotName)

      expect(slotNames).toContain('QB')
      expect(slotNames).toContain('RB')
      expect(slotNames).toContain('WR')
      expect(slotNames).toContain('TE')
      expect(slotNames).toContain('K')
      expect(slotNames).toContain('FLEX')
      expect(slotNames).not.toContain('DST')
    })

    it('IDP DYNASTY_IDP normalizes to IDP format', () => {
      const idpTemplate = getRosterTemplateDefinition('NFL', 'IDP')
      const dynastyIdpTemplate = getRosterTemplateDefinition('NFL', 'DYNASTY_IDP')

      expect(idpTemplate.slots.length).toBe(dynastyIdpTemplate.slots.length)
      expect(idpTemplate.slots.map((s) => s.slotName)).toEqual(
        dynastyIdpTemplate.slots.map((s) => s.slotName)
      )
    })

    it('IDP total starter slots includes offensive + defensive', () => {
      const template = getRosterTemplateDefinition('NFL', 'IDP')
      // QB:1, RB:2, WR:2, TE:1, K:1, FLEX:1 = 8 offensive
      // DE:2, DT:1, LB:2, CB:2, S:2 = 9 defensive fixed
      // DL:1, DB:1, IDP_FLEX:1 = 3 defensive flex
      // Total = 8 + 9 + 3 = 20
      expect(template.totalStarterSlots).toBe(20)
    })
  })

  describe('NFL IDP Position Eligibility', () => {
    it('DE position eligible for DE, DL slots', () => {
      expect(isPositionEligibleForSlot('NFL', 'DE', 'DE', 'IDP')).toBe(true)
      expect(isPositionEligibleForSlot('NFL', 'DL', 'DE', 'IDP')).toBe(true)
      expect(isPositionEligibleForSlot('NFL', 'IDP_FLEX', 'DE', 'IDP')).toBe(true)
    })

    it('DT position eligible for DT, DL slots', () => {
      expect(isPositionEligibleForSlot('NFL', 'DT', 'DT', 'IDP')).toBe(true)
      expect(isPositionEligibleForSlot('NFL', 'DL', 'DT', 'IDP')).toBe(true)
      expect(isPositionEligibleForSlot('NFL', 'IDP_FLEX', 'DT', 'IDP')).toBe(true)
    })

    it('LB position eligible for LB, IDP_FLEX', () => {
      expect(isPositionEligibleForSlot('NFL', 'LB', 'LB', 'IDP')).toBe(true)
      expect(isPositionEligibleForSlot('NFL', 'IDP_FLEX', 'LB', 'IDP')).toBe(true)
    })

    it('CB position eligible for CB, DB slots', () => {
      expect(isPositionEligibleForSlot('NFL', 'CB', 'CB', 'IDP')).toBe(true)
      expect(isPositionEligibleForSlot('NFL', 'DB', 'CB', 'IDP')).toBe(true)
      expect(isPositionEligibleForSlot('NFL', 'IDP_FLEX', 'CB', 'IDP')).toBe(true)
    })

    it('S position eligible for S, DB slots', () => {
      expect(isPositionEligibleForSlot('NFL', 'S', 'S', 'IDP')).toBe(true)
      expect(isPositionEligibleForSlot('NFL', 'DB', 'S', 'IDP')).toBe(true)
      expect(isPositionEligibleForSlot('NFL', 'IDP_FLEX', 'S', 'IDP')).toBe(true)
    })

    it('offensive position not eligible for defensive slots', () => {
      expect(isPositionEligibleForSlot('NFL', 'DE', 'WR', 'IDP')).toBe(false)
      expect(isPositionEligibleForSlot('NFL', 'DL', 'QB', 'IDP')).toBe(false)
      expect(isPositionEligibleForSlot('NFL', 'DB', 'RB', 'IDP')).toBe(false)
    })

    it('defensive position not eligible for offensive slots', () => {
      expect(isPositionEligibleForSlot('NFL', 'WR', 'DE', 'IDP')).toBe(false)
      expect(isPositionEligibleForSlot('NFL', 'QB', 'LB', 'IDP')).toBe(false)
      expect(isPositionEligibleForSlot('NFL', 'K', 'CB', 'IDP')).toBe(false)
    })

    it('all IDP positions returned by getPositionsForSport', () => {
      const idpPositions = getPositionsForSport('NFL', 'IDP')
      expect(idpPositions).toEqual(
        expect.arrayContaining(['QB', 'RB', 'WR', 'TE', 'K', 'DE', 'DT', 'LB', 'CB', 'S'])
      )
    })
  })

  describe('NFL IDP Roster Template DTO', () => {
    it('generates valid RosterTemplateDto for IDP', async () => {
      const template = await getRosterTemplate('NFL', 'IDP')

      expect(template.sportType).toBe('NFL')
      expect(template.formatType).toBe('IDP')
      expect(template.name).toContain('IDP')
      expect(template.slots.length).toBeGreaterThan(15)

      const slotNames = template.slots.map((s) => s.slotName)
      expect(slotNames).toContain('QB')
      expect(slotNames).toContain('DE')
      expect(slotNames).toContain('IDP_FLEX')
    })

    it('IDP slot order prioritizes offense then defense', async () => {
      const template = await getRosterTemplate('NFL', 'IDP')

      const slotOrder = template.slots.map((s) => s.slotName)
      expect(slotOrder.indexOf('QB')).toBeLessThan(slotOrder.indexOf('DE'))
      expect(slotOrder.indexOf('K')).toBeLessThan(slotOrder.indexOf('DE'))
    })

    it('IDP DYNASTY_IDP format normalizes to IDP', async () => {
      const idpTemplate = await getRosterTemplate('NFL', 'IDP')
      const dynastyIdpTemplate = await getRosterTemplate('NFL', 'DYNASTY_IDP')

      expect(idpTemplate.formatType).toBe('IDP')
      expect(dynastyIdpTemplate.formatType).toBe('IDP')
      expect(idpTemplate.slots.length).toBe(dynastyIdpTemplate.slots.length)
    })

    it('IDP flex slots have correct allowed positions', async () => {
      const template = await getRosterTemplate('NFL', 'IDP')

      const dlSlot = template.slots.find((s) => s.slotName === 'DL')
      expect(dlSlot?.allowedPositions).toEqual(expect.arrayContaining(['DE', 'DT']))

      const dbSlot = template.slots.find((s) => s.slotName === 'DB')
      expect(dbSlot?.allowedPositions).toEqual(expect.arrayContaining(['CB', 'S']))

      const idpFlexSlot = template.slots.find((s) => s.slotName === 'IDP_FLEX')
      expect(idpFlexSlot?.allowedPositions).toEqual(
        expect.arrayContaining(['DE', 'DT', 'LB', 'CB', 'S'])
      )
    })
  })

  describe('Sport Slot Name Ordering for Draft Room', () => {
    it('soccer returns slot names in order for draft room display', () => {
      const slotNames = getSlotNamesForSport('SOCCER')
      const firstBench = slotNames.indexOf('BENCH')

      expect(slotNames[0]).toBe('GKP')
      expect(slotNames.slice(0, firstBench)).toEqual(
        expect.arrayContaining(['GKP', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'UTIL'])
      )
    })

    it('IDP returns slot names in order prioritizing offense', () => {
      const slotNames = getSlotNamesForSport('NFL', 'IDP')
      const qbIndex = slotNames.indexOf('QB')
      const deIndex = slotNames.findIndex((s) => s === 'DE')

      expect(qbIndex).toBeLessThan(deIndex)
    })
  })

  describe('Roster Template Integration Summary', () => {
    it('soccer template is fully integrated and functional', async () => {
      // Definition
      const definition = getRosterTemplateDefinition('SOCCER')
      expect(definition.sportType).toBe('SOCCER')
      expect(definition.totalStarterSlots).toBe(12)

      // DTO
      const dto = await getRosterTemplate('SOCCER')
      expect(dto.formatType).toBe('standard')

      // Eligibility
      expect(isPositionEligibleForSlot('SOCCER', 'GKP', 'GK')).toBe(true)
    })

    it('IDP template is fully integrated and functional', async () => {
      // Definition
      const definition = getRosterTemplateDefinition('NFL', 'IDP')
      expect(definition.sportType).toBe('NFL')
      expect(definition.totalStarterSlots).toBe(20)

      // DTO
      const dto = await getRosterTemplate('NFL', 'IDP')
      expect(dto.formatType).toBe('IDP')

      // Eligibility
      expect(isPositionEligibleForSlot('NFL', 'DE', 'DE', 'IDP')).toBe(true)
      expect(isPositionEligibleForSlot('NFL', 'DL', 'DE', 'IDP')).toBe(true)
    })
  })
})
