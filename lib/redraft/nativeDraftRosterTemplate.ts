import type { RosterTemplateDto, RosterTemplateSlotDto } from '@/lib/multi-sport/RosterTemplateService'
import { isStandardDynasty } from '@/lib/dynasty-core/isStandardDynasty'
import { resolveRedraftRosterConfig } from './rosterConfigResolver'
import { allowedPositionsForSlot, normalizeToken, redraftPlayerPositionTokens } from './lineupValidation'

/** Native draft eligibility and materialization must use the same commissioned
 * slot layout as scoring, rather than an older shared DB template. */
export function nativeDraftRosterTemplate(base: RosterTemplateDto, sport: string, settings: unknown, league?: Parameters<typeof isStandardDynasty>[0]): RosterTemplateDto {
  if (!settings || typeof settings !== 'object' || (settings as Record<string, unknown>).lineup_history_version !== 1 && !isStandardDynasty(league ?? { settings })) return base
  const config = resolveRedraftRosterConfig(sport, settings)
  const slots: RosterTemplateSlotDto[] = [...config.starterCapacities].map(([slotName, starterCount], slotOrder) => ({
    slotName, starterCount, allowedPositions: allowedPositionsForSlot(sport, slotName),
    benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0,
    isFlexibleSlot: allowedPositionsForSlot(sport, slotName).length > 1, slotOrder,
  }))
  const allowed = [...new Set(slots.flatMap(slot => slot.allowedPositions))]
  for (const [slotName, count, kind] of [['BN',config.benchSlots,'benchCount'],['IR',config.irSlots,'reserveCount'],['TAXI',config.taxiSlots,'taxiCount']] as const) {
    if (!count) continue
    slots.push({ slotName, allowedPositions: allowed, starterCount: 0, benchCount: 0, reserveCount: 0,
      taxiCount: 0, devyCount: 0, isFlexibleSlot: true, slotOrder: slots.length, [kind]: count })
  }
  return { ...base, templateId: `${base.templateId}:native`, slots }
}

/** Maximum starter matching permits a multi-position player to move out of a
 * flex slot when a later pick needs it. Greedy slot counts cannot do that. */
export function matchStarterSlots(positions: readonly string[], slots: readonly { allowedPositions: readonly string[] }[]): Array<number | null> {
  const assigned = new Map<number, number>()
  const fits = (position: string, allowed: readonly string[]) => redraftPlayerPositionTokens(position)
    .some(p => allowed.some(a => normalizeToken(a) === p))
  const seat = (index: number, visited: Set<number>): boolean => {
    for (let slot = 0; slot < slots.length; slot++) {
      if (visited.has(slot) || !fits(positions[index], slots[slot].allowedPositions)) continue
      visited.add(slot)
      if (!assigned.has(slot) || seat(assigned.get(slot)!, visited)) { assigned.set(slot, index); return true }
    }
    return false
  }
  positions.forEach((_position, index) => { seat(index, new Set()) })
  const result: Array<number | null> = positions.map(() => null)
  for (const [slot, player] of assigned) result[player] = slot
  return result
}

export function matchedStarterCount(positions: readonly string[], slots: readonly { allowedPositions: readonly string[] }[]): number {
  return matchStarterSlots(positions, slots).filter(slot => slot !== null).length
}

export function preservesStarterCompletion(sport: string, settings: unknown, ownPositions: readonly string[], candidatePosition: string, draftRounds: number): boolean {
  if (!settings || typeof settings !== 'object' || (settings as Record<string, unknown>).lineup_history_version !== 1) return true
  const config = resolveRedraftRosterConfig(sport, settings)
  const slots = [...config.starterCapacities].flatMap(([slot, count]) => Array.from({ length: count }, () => ({ allowedPositions: allowedPositionsForSlot(sport, slot) })))
  if (draftRounds < slots.length) return true // Deliberately shortened/supplemental boards cannot fill every starter.
  const remaining = draftRounds - ownPositions.length - 1
  return slots.length - matchedStarterCount([...ownPositions, candidatePosition], slots) <= remaining
}
