import type { LeagueSport } from '@prisma/client'
import { getRosterDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import { normalizeToSupportedSport, supportsIdpLeagueSport } from '@/lib/sport-scope'

export type FormatRosterModifierId =
  | 'superflex'
  | 'idp'
  | 'te_premium'
  | 'taxi'
  | 'devy'
  | 'c2c'
  | 'salary_cap'
  | 'best_ball'

type FormatRosterDefaults = {
  sport: LeagueSport
  starterSlots: Record<string, number>
  benchSlots: number
  irSlots: number
  taxiSlots: number
  devySlots: number
  flexDefinitions: Array<{ slotName: string; allowedPositions: string[] }>
  rosterSize: number
  modifiers: FormatRosterModifierId[]
}

function toRosterSize(slots: FormatRosterDefaults): number {
  return (
    Object.values(slots.starterSlots).reduce((sum, count) => sum + count, 0) +
    slots.benchSlots +
    slots.irSlots +
    slots.taxiSlots +
    slots.devySlots
  )
}

function normalizeVariantForRoster(
  sport: LeagueSport,
  formatId?: string | null,
  modifiers: FormatRosterModifierId[] = []
): string | undefined {
  if (modifiers.includes('idp') && supportsIdpLeagueSport(sport)) return 'IDP'
  if (formatId === 'devy') return 'devy_dynasty'
  if (formatId === 'c2c') return 'merged_devy_c2c'
  if (modifiers.includes('superflex') && sport === 'NFL') return 'SUPERFLEX'
  return undefined
}

function resolveZombieRosterDefaults(
  sport: LeagueSport,
  modifiers: FormatRosterModifierId[],
): FormatRosterDefaults {
  const idpActive = supportsIdpLeagueSport(sport) && modifiers.includes('idp')
  if (idpActive) {
    const idp = getRosterDefaults(sport, 'IDP')
    const starterSlots = { ...idp.starter_slots }
    const flexDefinitions = [...idp.flex_definitions]
    const resolved: FormatRosterDefaults = {
      sport,
      starterSlots,
      benchSlots: idp.bench_slots,
      irSlots: 0,
      taxiSlots: 0,
      devySlots: 0,
      flexDefinitions,
      rosterSize: 0,
      modifiers,
    }
    resolved.rosterSize = toRosterSize(resolved)
    return resolved
  }

  if (sport === 'NFL') {
    const resolved: FormatRosterDefaults = {
      sport: 'NFL',
      starterSlots: { FLEX: 4, SUPERFLEX: 1 },
      benchSlots: 3,
      irSlots: 0,
      taxiSlots: 0,
      devySlots: 0,
      flexDefinitions: [
        { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] },
        { slotName: 'SUPERFLEX', allowedPositions: ['QB', 'RB', 'WR', 'TE'] },
      ],
      rosterSize: 0,
      modifiers,
    }
    resolved.rosterSize = toRosterSize(resolved)
    return resolved
  }

  if (sport === 'NBA' || sport === 'NCAAB') {
    const resolved: FormatRosterDefaults = {
      sport,
      starterSlots: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1 },
      benchSlots: 3,
      irSlots: 0,
      taxiSlots: 0,
      devySlots: 0,
      flexDefinitions: [],
      rosterSize: 0,
      modifiers,
    }
    resolved.rosterSize = toRosterSize(resolved)
    return resolved
  }

  if (sport === 'MLB') {
    const resolved: FormatRosterDefaults = {
      sport: 'MLB',
      starterSlots: { C: 1, OF: 2, UTIL: 2 },
      benchSlots: 3,
      irSlots: 0,
      taxiSlots: 0,
      devySlots: 0,
      flexDefinitions: [{ slotName: 'UTIL', allowedPositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'] }],
      rosterSize: 0,
      modifiers,
    }
    resolved.rosterSize = toRosterSize(resolved)
    return resolved
  }

  if (sport === 'NHL') {
    const resolved: FormatRosterDefaults = {
      sport: 'NHL',
      starterSlots: { F: 2, D: 2, UTIL: 1, G: 1 },
      benchSlots: 3,
      irSlots: 0,
      taxiSlots: 0,
      devySlots: 0,
      flexDefinitions: [
        { slotName: 'F', allowedPositions: ['LW', 'RW', 'C'] },
        { slotName: 'UTIL', allowedPositions: ['LW', 'RW', 'C', 'D'] },
      ],
      rosterSize: 0,
      modifiers,
    }
    resolved.rosterSize = toRosterSize(resolved)
    return resolved
  }

  if (sport === 'NCAAF') {
    const resolved: FormatRosterDefaults = {
      sport: 'NCAAF',
      starterSlots: { FLEX: 4, SUPERFLEX: 1 },
      benchSlots: 3,
      irSlots: 0,
      taxiSlots: 0,
      devySlots: 0,
      flexDefinitions: [
        { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] },
        { slotName: 'SUPERFLEX', allowedPositions: ['QB', 'RB', 'WR', 'TE'] },
      ],
      rosterSize: 0,
      modifiers,
    }
    resolved.rosterSize = toRosterSize(resolved)
    return resolved
  }

  const fb = getRosterDefaults(sport, undefined)
  const resolved: FormatRosterDefaults = {
    sport,
    starterSlots: { ...fb.starter_slots },
    benchSlots: 3,
    irSlots: 0,
    taxiSlots: 0,
    devySlots: 0,
    flexDefinitions: [...fb.flex_definitions],
    rosterSize: 0,
    modifiers,
  }
  resolved.rosterSize = toRosterSize(resolved)
  return resolved
}

export function resolveFormatRosterDefaults(options: {
  sport: LeagueSport | string
  formatId?: string | null
  modifiers?: FormatRosterModifierId[]
}): FormatRosterDefaults {
  const sport = normalizeToSupportedSport(options.sport)
  const modifiers = [...new Set(options.modifiers ?? [])]

  if (options.formatId === 'zombie') {
    return resolveZombieRosterDefaults(sport, modifiers)
  }

  const variant = normalizeVariantForRoster(sport, options.formatId, modifiers)
  const base = getRosterDefaults(sport, variant)

  const starterSlots = { ...base.starter_slots }
  const flexDefinitions = [...base.flex_definitions]
  let benchSlots = base.bench_slots
  let irSlots = base.IR_slots
  let taxiSlots = base.taxi_slots
  let devySlots = base.devy_slots

  if (modifiers.includes('superflex') && !('SUPERFLEX' in starterSlots) && sport === 'NFL') {
    starterSlots.SUPERFLEX = 1
    flexDefinitions.push({
      slotName: 'SUPERFLEX',
      allowedPositions: ['QB', 'RB', 'WR', 'TE'],
    })
  }

  if (modifiers.includes('taxi') && taxiSlots === 0) {
    taxiSlots = sport === 'NFL' || sport === 'NCAAF' ? 4 : 2
  }

  if (options.formatId === 'dynasty' && benchSlots < 10) {
    benchSlots = sport === 'SOCCER' ? 6 : 10
  }

  if (options.formatId === 'keeper' && benchSlots < 6) {
    benchSlots = 6
  }

  if (options.formatId === 'best_ball' && benchSlots < 8) {
    benchSlots = 8
  }

  if (options.formatId === 'salary_cap' && irSlots < 2) {
    irSlots = 2
  }

  if (options.formatId === 'devy' && devySlots === 0) {
    devySlots = sport === 'NBA' || sport === 'NCAAB' ? 5 : 6
    taxiSlots = Math.max(taxiSlots, sport === 'NBA' || sport === 'NCAAB' ? 4 : 6)
    irSlots = Math.max(irSlots, 3)
  }

  if (options.formatId === 'c2c') {
    devySlots = Math.max(devySlots, sport === 'NBA' || sport === 'NCAAB' ? 10 : 14)
    taxiSlots = Math.max(taxiSlots, sport === 'NBA' || sport === 'NCAAB' ? 4 : 6)
    irSlots = Math.max(irSlots, 3)
  }

  const resolved: FormatRosterDefaults = {
    sport,
    starterSlots,
    benchSlots,
    irSlots,
    taxiSlots,
    devySlots,
    flexDefinitions,
    rosterSize: 0,
    modifiers,
  }

  resolved.rosterSize = toRosterSize(resolved)
  return resolved
}
