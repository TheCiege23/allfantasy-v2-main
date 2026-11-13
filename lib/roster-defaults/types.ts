/**
 * Default roster settings by sport — types for slots, validation, eligibility.
 */

export type SportType =
  | 'NFL'
  | 'NBA'
  | 'MLB'
  | 'NHL'
  | 'NCAAF'
  | 'NCAAB'
  | 'SOCCER'

/** Single slot definition (starter, bench, IR, flex, utility, superflex, etc.). */
export interface RosterSlotDefinition {
  slotName: string
  slotType: 'starter' | 'bench' | 'ir' | 'taxi' | 'devy'
  allowedPositions: string[]
  count: number
  isFlexibleSlot: boolean
  order: number
}

/** Full roster template definition for a sport (ordered slots for draft/lineup/waiver). */
export interface RosterTemplateDefinition {
  sportType: SportType
  formatType: string
  slots: RosterSlotDefinition[]
  totalStarterSlots: number
  totalBenchSlots: number
  totalIRSlots: number
  totalTaxiSlots: number
  totalDevySlots: number
}

