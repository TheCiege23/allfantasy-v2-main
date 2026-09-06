/**
 * Registry of default roster slot definitions per sport (and format, e.g. NFL IDP).
 * Single source for starter slots, bench, IR, flex, utility, superflex, goalie/pitcher (G, SP, RP, P), taxi/devy.
 * Built from sport-defaults SportDefaultsRegistry.getRosterDefaults(); used by
 * PositionEligibilityResolver and RosterValidationEngine for draft room position filtering, waiver eligibility, and lineup validation.
 *
 * Soccer: GKP, DEF, MID, FWD, UTIL, BENCH, IR (GKP accepts GK alias in eligibility).
 * NFL IDP: offensive slots (QB, RB, WR, TE, FLEX, K) + DE, DT, LB, CB, S, DL, DB, IDP_FLEX, BENCH, IR.
 */
import type { SportType, RosterSlotDefinition, RosterTemplateDefinition } from './types'
import { getRosterDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import { toSportType } from '@/lib/sport-defaults/sport-type-utils'

function buildSlotsFromRegistry(sportType: SportType, formatType?: string): RosterSlotDefinition[] {
  const def = getRosterDefaults(sportType, formatType)
  const slots: RosterSlotDefinition[] = []
  let order = 0

  for (const [slotName, count] of Object.entries(def.starter_slots)) {
    if (count <= 0) continue
    const flexDef = def.flex_definitions.find((f) => f.slotName === slotName)
    const allowedPositions = flexDef?.allowedPositions ?? [slotName]
    const isFlex = !!flexDef || ['FLEX', 'UTIL', 'G', 'F', 'SUPERFLEX', 'P', 'DL', 'DB', 'IDP_FLEX'].includes(slotName)
    slots.push({
      slotName,
      slotType: 'starter',
      allowedPositions,
      count,
      isFlexibleSlot: isFlex,
      order: order++,
    })
  }

  if (def.bench_slots > 0) {
    const flexSlotNames = ['FLEX', 'UTIL', 'G', 'F', 'SUPERFLEX', 'P', 'DL', 'DB', 'IDP_FLEX']
    const playerPositions = new Set<string>()
    for (const [slotName, count] of Object.entries(def.starter_slots)) {
      if (count <= 0) continue
      const flexDef = def.flex_definitions.find((f) => f.slotName === slotName)
      if (flexDef) flexDef.allowedPositions.forEach((p) => playerPositions.add(p))
      else if (!flexSlotNames.includes(slotName)) playerPositions.add(slotName)
    }
    const allPositions = playerPositions.size > 0 ? [...playerPositions] : ['*']
    slots.push({
      slotName: 'BENCH',
      slotType: 'bench',
      allowedPositions: allPositions,
      count: def.bench_slots,
      isFlexibleSlot: false,
      order: order++,
    })
  }

  if (def.IR_slots > 0) {
    slots.push({
      slotName: 'IR',
      slotType: 'ir',
      allowedPositions: ['*'],
      count: def.IR_slots,
      isFlexibleSlot: false,
      order: order++,
    })
  }

  if (def.taxi_slots > 0) {
    slots.push({
      slotName: 'TAXI',
      slotType: 'taxi',
      allowedPositions: ['*'],
      count: def.taxi_slots,
      isFlexibleSlot: false,
      order: order++,
    })
  }

  if (def.devy_slots > 0) {
    slots.push({
      slotName: 'DEVY',
      slotType: 'devy',
      allowedPositions: ['*'],
      count: def.devy_slots,
      isFlexibleSlot: false,
      order: order++,
    })
  }

  return slots
}

/**
 * Get full roster template definition for a sport (and optional format, e.g. IDP for NFL).
 */
export function getRosterTemplateDefinition(
  sportType: SportType | string,
  formatType?: string
): RosterTemplateDefinition {
  const sport = toSportType(typeof sportType === 'string' ? sportType : sportType)
  const format = formatType ?? 'standard'
  const slots = buildSlotsFromRegistry(sport, format)
  let totalStarter = 0
  let totalBench = 0
  let totalIR = 0
  let totalTaxi = 0
  let totalDevy = 0
  for (const s of slots) {
    if (s.slotType === 'starter') totalStarter += s.count
    else if (s.slotType === 'bench') totalBench += s.count
    else if (s.slotType === 'ir') totalIR += s.count
    else if (s.slotType === 'taxi') totalTaxi += s.count
    else if (s.slotType === 'devy') totalDevy += s.count
  }
  return {
    sportType: sport,
    formatType: format,
    slots,
    totalStarterSlots: totalStarter,
    totalBenchSlots: totalBench,
    totalIRSlots: totalIR,
    totalTaxiSlots: totalTaxi,
    totalDevySlots: totalDevy,
  }
}

/**
 * Get ordered list of slot names for draft room display (starter slots then bench, IR, etc.).
 */
export function getSlotNamesForSport(sportType: SportType | string, formatType?: string): string[] {
  const def = getRosterTemplateDefinition(sportType, formatType)
  return def.slots.flatMap((s) => Array(s.count).fill(s.slotName))
}
