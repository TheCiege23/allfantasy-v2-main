import { allowedPositionsForSlot, cannotStart, normalizeToken } from '@/lib/redraft/lineupValidation'
import type { ResolvedRosterConfig } from '@/lib/redraft/rosterConfigResolver'

export function pirateActivationSection(slotType: string): 'IR' | 'TAXI' | null {
  const token = normalizeToken(slotType)
  return ['IR', 'IL', 'IL_PLUS', 'RESERVE'].includes(token) ? 'IR' : token === 'TAXI' ? 'TAXI' : null
}

export type PirateLineupPlayer = {
  playerId: string
  playerName: string
  position: string
  slotType: string
  injuryStatus?: string | null
  byeWeek?: number | null
  /** A candidate can count only when their game has not locked. */
  addableBeforeLock?: boolean
  /** Schedule permits a reserve promotion; canonical promotion checks must still certify a plan. */
  activationBeforeLock?: boolean
  /** An active starter already locked in place can remain, but cannot be rearranged. */
  lockedAtSnapshot?: boolean
  /** This certified waiver option requires this specific bench drop. Never combine independent plans. */
  dropPlayerId?: string | null
  /** Daily evidence distinguishes a known off day from missing schedule data. */
  hasGameOnScoringDay?: boolean
  starterSlotIndex?: number | null
  jointPlanOnly?: boolean
}

export type PirateLineupPlan = {
  eventAt: string; checkedAt: string
  steps: Array<{ kind: 'pickup' | 'activate'; playerId: string; dropPlayerId?: string | null; fromSlot?: string }>
  assignment: Array<{ playerId: string; slotType: string; slotIndex: number }>
}

export type PirateLineupFinding = {
  decision: 'legal' | 'forfeit' | 'excused' | 'review'
  issues: string[]
  replacementIds: string[]
  reason: string
  assignment?: PirateLineupPlan['assignment']
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
  /** Entire sequences certified together by canonical transaction and lineup gates. */
  certifiedPlans?: PirateLineupPlan[]
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
      if (player.hasGameOnScoringDay === false) issues.push(`${slot}: ${player.playerName} has no game on this scoring day`)
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
  const active = (player: PirateLineupPlayer) => player.byeWeek !== input.week && player.hasGameOnScoringDay !== false && !cannotStart(player)
  const rosterCandidates = input.roster.filter((player) => active(player) &&
    (input.rosterConfig.starterCapacities.has(normalizeToken(player.slotType)) || player.addableBeforeLock === true))
  const waiverCandidates = input.waivers.filter((player) => active(player) && player.addableBeforeLock === true)
  function legalAssignment(candidates: PirateLineupPlayer[]): PirateLineupPlan['assignment'] | null {
    // A locked starter occupies his exact slot. He cannot be silently replaced
    // by the matching algorithm, even by a better eligible bench player.
    const remainingSlots = slots.map((slotType, slotIndex) => ({ slotType, slotIndex }))
    const reserved = input.roster.filter((player) => player.lockedAtSnapshot &&
      input.rosterConfig.starterCapacities.has(normalizeToken(player.slotType)))
    for (const player of reserved) {
      const slot = normalizeToken(player.slotType)
      const index = remainingSlots.findIndex((s) => s.slotType === slot && (player.starterSlotIndex == null || s.slotIndex === player.starterSlotIndex))
      if (index < 0 || !active(player) || !allowedPositionsForSlot(input.sport, slot).includes(normalizeToken(player.position))) return null
      remainingSlots.splice(index, 1)
    }
    const reservedIds = new Set(reserved.map((player) => player.playerId))
    const movable = candidates.filter((player) => !reservedIds.has(player.playerId))
    const assigned = new Map<string, number>()
    function place(slotIndex: number, seen: Set<string>): boolean {
      for (const player of movable) {
        if (seen.has(player.playerId)) continue
        if (!allowedPositionsForSlot(input.sport, remainingSlots[slotIndex].slotType).includes(normalizeToken(player.position))) continue
        if (player.lockedAtSnapshot && normalizeToken(player.slotType) !== remainingSlots[slotIndex].slotType) continue
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
    return feasible ? [...reserved.map((p) => ({ playerId: p.playerId, slotType: normalizeToken(p.slotType),
      slotIndex: p.starterSlotIndex ?? slots.findIndex((slot) => slot === normalizeToken(p.slotType)) })),
      ...[...assigned].map(([playerId, index]) => ({ playerId, ...remainingSlots[index] }))] : null
  }
  const found = (assignment: PirateLineupPlan['assignment'], reason: string): PirateLineupFinding =>
    ({ decision: 'forfeit', issues, replacementIds: assignment.map((p) => p.playerId), assignment, reason })
  const rosterAssignment = legalAssignment(rosterCandidates)
  if (rosterAssignment) return found(rosterAssignment, 'A complete legal lineup was available on the roster before lock.')
  // Independent no-drop checks do not prove room or acquisition budget for a combined move.
  for (const candidate of waiverCandidates.filter((p) => p.dropPlayerId == null && !p.jointPlanOnly)) {
    const assignment = legalAssignment([...rosterCandidates, candidate])
    if (assignment) return found(assignment, 'A complete legal lineup was available through an addable waiver before lock.')
  }
  for (const candidate of waiverCandidates.filter((p) => p.dropPlayerId != null && !p.jointPlanOnly)) {
    const drop = input.roster.find((p) => p.playerId === candidate.dropPlayerId)
    if (!drop || normalizeToken(drop.slotType) !== 'BENCH' || drop.lockedAtSnapshot || !drop.addableBeforeLock) continue
    const assignment = legalAssignment([...rosterCandidates.filter((p) => p.playerId !== drop.playerId), candidate])
    if (assignment) return found(assignment, `A complete legal lineup was available through one verified pickup and a legal drop of ${drop.playerName} before lock.`)
  }
  for (const plan of input.certifiedPlans ?? []) {
    const dropped = new Set(plan.steps.flatMap((s) => s.dropPlayerId ? [s.dropPlayerId] : []))
    const activated = new Set(plan.steps.filter((s) => s.kind === 'activate').map((s) => s.playerId))
    const added = new Set(plan.steps.filter((s) => s.kind === 'pickup').map((s) => s.playerId))
    const candidates = input.roster.filter((p) => !dropped.has(p.playerId) && active(p) &&
      (rosterCandidates.includes(p) || (activated.has(p.playerId) && p.activationBeforeLock === true && !p.lockedAtSnapshot)))
    const byId = new Map([...candidates, ...waiverCandidates.filter((p) => added.has(p.playerId))].map((p) => [p.playerId, p]))
    const assignment = plan.assignment
    // Validate the recorded assignment itself. Equivalent repeated slots can be
    // matched in a different order when providers return candidates differently.
    const complete = assignment.length === slots.length && new Set(assignment.map((p) => p.playerId)).size === slots.length &&
      new Set(assignment.map((p) => p.slotIndex)).size === slots.length && assignment.every((seat) => {
        const player = byId.get(seat.playerId)
        return !!player && seat.slotType === slots[seat.slotIndex] && allowedPositionsForSlot(input.sport, seat.slotType).includes(normalizeToken(player.position)) &&
          (!player.lockedAtSnapshot || (normalizeToken(player.slotType) === seat.slotType &&
            (player.starterSlotIndex == null || player.starterSlotIndex === seat.slotIndex)))
      }) && input.roster.filter((p) => p.lockedAtSnapshot && input.rosterConfig.starterCapacities.has(normalizeToken(p.slotType)))
      .every((p) => active(p) && assignment.some((seat) => seat.playerId === p.playerId && seat.slotType === normalizeToken(p.slotType) &&
        (p.starterSlotIndex == null || seat.slotIndex === p.starterSlotIndex)))
    if (complete) return found(assignment,
      'A complete legal lineup was available through a jointly verified sequence of roster moves before lock.')
  }
  if (!input.waiverPoolCertified) return { decision: 'review', issues, replacementIds: [], reason: 'The historical addable waiver pool is incomplete.' }
  return { decision: 'excused', issues, replacementIds: [], reason: 'No complete legal lineup was available on the roster or addable waivers before lock.' }
}
