/**
 * IDP roster presets: Beginner, Standard, Advanced (and custom via overrides).
 * Returns starter_slots + flex_definitions compatible with RosterDefaults.
 * PROMPT 2/6.
 */

import type { RosterDefaults } from '@/lib/sport-defaults/types'
import type { SportType } from '@/lib/sport-defaults/types'
import type { IdpPositionMode, IdpRosterPreset, IdpSlotOverrides } from './types'

/** Base football offensive slots (no DST for IDP leagues; offense + IDP). */
const FOOTBALL_IDP_OFFENSE_STARTER_SLOTS: Record<'NFL' | 'NCAAF', Record<string, number>> = {
  NFL: {
    QB: 1,
    RB: 2,
    WR: 2,
    TE: 1,
    FLEX: 1,
    K: 1,
  },
  NCAAF: {
    QB: 1,
    RB: 2,
    WR: 2,
    TE: 1,
    FLEX: 1,
    SUPERFLEX: 1,
    K: 1,
  },
}

const FOOTBALL_IDP_OFFENSE_FLEX: Record<'NFL' | 'NCAAF', Array<{ slotName: string; allowedPositions: string[] }>> = {
  NFL: [{ slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] }],
  NCAAF: [
    { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] },
    { slotName: 'SUPERFLEX', allowedPositions: ['QB', 'RB', 'WR', 'TE'] },
  ],
}

function resolveIdpSport(sportType?: SportType | null): 'NFL' | 'NCAAF' {
  return sportType === 'NCAAF' ? 'NCAAF' : 'NFL'
}

/** Base NFL offense preserved for backward compatibility in existing callers. */
const NFL_OFFENSE_STARTER_SLOTS: Record<string, number> = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
  K: 1,
  // DST: 0 for IDP — not included
}

const NFL_OFFENSE_FLEX = [{ slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] }]

/** Beginner IDP: 1 DL, 2 LB, 2 DB, 1 IDP FLEX; modest bench. Grouped positions only. */
function beginnerSlots(): Record<string, number> {
  return {
    DL: 1,
    LB: 2,
    DB: 2,
    IDP_FLEX: 1,
  }
}

/** Standard IDP: 2 DL, 2 LB, 2 DB, 2 IDP FLEX. Grouped. */
function standardSlots(): Record<string, number> {
  return {
    DL: 2,
    LB: 2,
    DB: 2,
    IDP_FLEX: 2,
  }
}

/** Advanced IDP: 2 DE, 1 DT, 3 LB, 2 CB, 2 S, 1 IDP FLEX. Split positions. */
function advancedSlots(): Record<string, number> {
  return {
    DE: 2,
    DT: 1,
    LB: 3,
    CB: 2,
    S: 2,
    IDP_FLEX: 1,
  }
}

function idpFlexDefinitions(positionMode: IdpPositionMode, sportType?: SportType | null): Array<{ slotName: string; allowedPositions: string[] }> {
  const resolvedSport = resolveIdpSport(sportType)
  const allIdp = ['DE', 'DT', 'LB', 'CB', 'S']
  const flexDefs: Array<{ slotName: string; allowedPositions: string[] }> = [
    ...(FOOTBALL_IDP_OFFENSE_FLEX[resolvedSport] ?? NFL_OFFENSE_FLEX),
    { slotName: 'DL', allowedPositions: ['DE', 'DT'] },
    { slotName: 'DB', allowedPositions: ['CB', 'S'] },
    { slotName: 'IDP_FLEX', allowedPositions: allIdp },
  ]
  return flexDefs
}

/**
 * Build IDP starter_slots from preset + optional overrides.
 * For custom preset, only overrides are used (no preset shape).
 */
export function buildIdpStarterSlots(
  preset: IdpRosterPreset,
  overrides: IdpSlotOverrides | null,
  positionMode: IdpPositionMode
): Record<string, number> {
  let idpSlots: Record<string, number>
  if (preset === 'custom' && overrides) {
    idpSlots = {}
    if (overrides.DL != null && overrides.DL > 0) idpSlots.DL = overrides.DL
    if (overrides.LB != null && overrides.LB > 0) idpSlots.LB = overrides.LB
    if (overrides.DB != null && overrides.DB > 0) idpSlots.DB = overrides.DB
    if (overrides.IDP_FLEX != null && overrides.IDP_FLEX > 0) idpSlots.IDP_FLEX = overrides.IDP_FLEX
    if (overrides.DE != null && overrides.DE > 0) idpSlots.DE = overrides.DE
    if (overrides.DT != null && overrides.DT > 0) idpSlots.DT = overrides.DT
    if (overrides.CB != null && overrides.CB > 0) idpSlots.CB = overrides.CB
    if (overrides.S != null && overrides.S > 0) idpSlots.S = overrides.S
  } else if (positionMode === 'advanced' || (positionMode === 'hybrid' && preset === 'advanced')) {
    idpSlots = advancedSlots()
    if (preset === 'advanced' && overrides) {
      if (overrides.DE != null) idpSlots.DE = overrides.DE
      if (overrides.DT != null) idpSlots.DT = overrides.DT
      if (overrides.LB != null) idpSlots.LB = overrides.LB
      if (overrides.CB != null) idpSlots.CB = overrides.CB
      if (overrides.S != null) idpSlots.S = overrides.S
      if (overrides.IDP_FLEX != null) idpSlots.IDP_FLEX = overrides.IDP_FLEX
    }
  } else {
    idpSlots = preset === 'beginner' ? beginnerSlots() : standardSlots()
    if (overrides) {
      if (overrides.DL != null) idpSlots.DL = overrides.DL
      if (overrides.LB != null) idpSlots.LB = overrides.LB
      if (overrides.DB != null) idpSlots.DB = overrides.DB
      if (overrides.IDP_FLEX != null) idpSlots.IDP_FLEX = overrides.IDP_FLEX
    }
  }
  return idpSlots
}

/**
 * Get full RosterDefaults for an IDP league from preset and config.
 * Merges NFL offense + IDP slots; bench/IR from config or defaults.
 */
export function getRosterDefaultsForIdpPreset(
  preset: IdpRosterPreset,
  overrides: IdpSlotOverrides | null,
  positionMode: IdpPositionMode,
  benchSlots: number = 7,
  irSlots: number = 2,
  sportType?: SportType | null
): Pick<RosterDefaults, 'starter_slots' | 'bench_slots' | 'IR_slots' | 'flex_definitions'> {
  const resolvedSport = resolveIdpSport(sportType)
  const idpSlots = buildIdpStarterSlots(preset, overrides, positionMode)
  const offenseSlots =
    FOOTBALL_IDP_OFFENSE_STARTER_SLOTS[resolvedSport] ??
    NFL_OFFENSE_STARTER_SLOTS
  const starter_slots = { ...offenseSlots, ...idpSlots }
  const bench_slots = overrides?.bench ?? benchSlots
  const IR_slots = overrides?.ir ?? irSlots
  const flex_definitions = idpFlexDefinitions(positionMode, resolvedSport)
  return {
    starter_slots,
    bench_slots,
    IR_slots,
    flex_definitions,
  }
}

/**
 * Get roster defaults for display/API (full RosterDefaults shape).
 */
export function getFullRosterDefaultsForIdp(
  preset: IdpRosterPreset,
  overrides: IdpSlotOverrides | null,
  positionMode: IdpPositionMode,
  benchSlots: number = 7,
  irSlots: number = 2,
  sportType?: SportType | null
): RosterDefaults {
  const resolvedSport = resolveIdpSport(sportType)
  const partial = getRosterDefaultsForIdpPreset(preset, overrides, positionMode, benchSlots, irSlots, resolvedSport)
  return {
    sport_type: resolvedSport,
    ...partial,
    taxi_slots: 0,
    devy_slots: 0,
  }
}
