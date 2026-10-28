import { allowedPositionsForSlot, cannotStart, normalizeToken } from '@/lib/redraft/lineupValidation'
import type { ResolvedRosterConfig } from '@/lib/redraft/rosterConfigResolver'

export type PirateLineupPlayer = {
  playerId: string
  playerName: string
  position: string
  slotType: string
  injuryStatus?: string | null
  byeWeek?: number | null
  /** A candidate can count only when their game has not locked. */
  addableBeforeLock?: boolean
  /** An active starter already locked in place can remain, but cannot be rearranged. */
  lockedAtSnapshot?: boolean
}

export type PirateLineupFinding = {
  decision: 'legal' | 'forfeit' | 'excused' | 'review'
  issues: string[]
  replacementIds: string[]
  reason: string
}

/**
 * Evaluate one certified scoring-day/period snapshot. Callers must supply the
 * actual lineup and player statuses at lock, and waivers proven addable before
 * that lock. Missing historical evidence always yields review, never forfeiture.
 */
export function evaluatePirateLineup(input: {
  sport: string
  week: number
  rosterConfig: ResolvedRosterConfig
  roster: PirateLineupPlayer[]
  waivers: PirateLineupPlayer[]
  lineupAtLockCertified: boolean
  availabilityAtLockCertified: boolean
  waiverPoolCertified: boolean
}): PirateLineupFinding {
  const slots = [...input.rosterConfig.starterCapacities].flatMap(([slot, count]) =>
    Array.from({ length: count }, () => slot))
  if (!slots.length) return { decision: 'review', issues: [], replacementIds: [], reason: 'Starter settings are unavailable.' }
  const bySlot = new Map<string, PirateLineupPlayer[]>()
  for (const player of input.roster) {
    const slot = normalizeToken(player.slotType)
    if (input.rosterConfig.starterCapacities.has(slot)) bySlot.set(slot, [...(bySlot.get(slot) ?? []), player])
  }
  const issues: string[] = []
  for (const [slot, count] of input.rosterConfig.starterCapacities) {
    const starters = bySlot.get(slot) ?? []
    if (starters.length < count) issues.push(`${slot}: ${count - starters.length} empty`)
    if (starters.length > count) issues.push(`${slot}: ${starters.length - count} extra starter`)
    for (const player of starters) {
      if (!allowedPositionsForSlot(input.sport, slot).includes(normalizeToken(player.position))) issues.push(`${slot}: ${player.playerName} is position-ineligible`)
      if (player.byeWeek === input.week) issues.push(`${slot}: ${player.playerName} is on bye`)
      if (cannotStart(player)) issues.push(`${slot}: ${player.playerName} is ${player.injuryStatus}`)
    }
  }
  if (!input.lineupAtLockCertified || !input.availabilityAtLockCertified) {
    return { decision: 'review', issues, replacementIds: [], reason: 'Historical lineup, injury, schedule, or addable waiver evidence is incomplete.' }
  }
  if (!issues.length) return { decision: 'legal', issues, replacementIds: [], reason: 'Required starters are filled by eligible active players.' }
  // A legal lineup needs a distinct active player for every starter slot. Keep
  // eligible current starters in the pool: a flex/position rearrangement may
  // repair multiple holes without a waiver add. Bench and waiver candidates
  // count only when their own game and acquisition were still open at lock.
  const active = (player: PirateLineupPlayer) => player.byeWeek !== input.week && !cannotStart(player)
  const rosterCandidates = input.roster.filter((player) => active(player) &&
    (input.rosterConfig.starterCapacities.has(normalizeToken(player.slotType)) || player.addableBeforeLock === true))
  const waiverCandidates = input.waivers.filter((player) => active(player) && player.addableBeforeLock === true)
  function legalAssignment(candidates: PirateLineupPlayer[]): string[] | null {
    // A locked starter occupies his exact slot. He cannot be silently replaced
    // by the matching algorithm, even by a better eligible bench player.
    const remainingSlots = [...slots]
    const reserved = input.roster.filter((player) => player.lockedAtSnapshot &&
      input.rosterConfig.starterCapacities.has(normalizeToken(player.slotType)))
    for (const player of reserved) {
      const slot = normalizeToken(player.slotType)
      const index = remainingSlots.indexOf(slot)
      if (index < 0 || !active(player) || !allowedPositionsForSlot(input.sport, slot).includes(normalizeToken(player.position))) return null
      remainingSlots.splice(index, 1)
    }
    const reservedIds = new Set(reserved.map((player) => player.playerId))
    const movable = candidates.filter((player) => !reservedIds.has(player.playerId))
    const assigned = new Map<string, number>()
    function place(slotIndex: number, seen: Set<string>): boolean {
      for (const player of movable) {
        if (seen.has(player.playerId)) continue
        if (!allowedPositionsForSlot(input.sport, remainingSlots[slotIndex]).includes(normalizeToken(player.position))) continue
        if (player.lockedAtSnapshot && normalizeToken(player.slotType) !== remainingSlots[slotIndex]) continue
        seen.add(player.playerId)
        const previous = assigned.get(player.playerId)
        if (previous == null || place(previous, seen)) {
          assigned.set(player.playerId, slotIndex)
          return true
        }
      }
      return false
    }
    const feasible = remainingSlots.every((_, index) => place(index, new Set()))
    return feasible ? [...reservedIds, ...assigned.keys()] : null
  }
  const rosterAssignment = legalAssignment(rosterCandidates)
  if (rosterAssignment) return { decision: 'forfeit', issues, replacementIds: rosterAssignment, reason: 'A complete legal lineup was available on the roster before lock.' }
  const waiverAssignment = legalAssignment([...rosterCandidates, ...waiverCandidates])
  if (waiverAssignment) return { decision: 'forfeit', issues, replacementIds: waiverAssignment, reason: 'A complete legal lineup was available through addable waivers before lock.' }
  if (!input.waiverPoolCertified) return { decision: 'review', issues, replacementIds: [], reason: 'The historical addable waiver pool is incomplete.' }
  return { decision: 'excused', issues, replacementIds: [], reason: 'No complete legal lineup was available on the roster or addable waivers before lock.' }
}
