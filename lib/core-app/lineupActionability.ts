import { isEligibleForSlot, startingSlotTemplate } from './rosterSlots'

export type CoveragePlayer = { id: string; position: string | null; unavailable?: boolean; inactive?: boolean; bye?: boolean }

/** Maximum legal assignment: each player can cover only one slot, including flex. */
export function bestBallCoverage(slots: string[], players: CoveragePlayer[]): { missing: string[]; unknown: boolean } {
  const template = startingSlotTemplate({ roster_positions: slots })
  if (!template || template.some(slot => !['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].some(pos => isEligibleForSlot(slot, pos)))) return { missing: [], unknown: true }
  const eligible = [...new Map(players.filter(p => !p.unavailable && !p.inactive && !p.bye).map(p => [p.id, p])).values()]
  if (eligible.some(p => !p.position)) return { missing: [], unknown: true }
  const assignments = new Map<string, number>()
  function assign(slot: number, visited: Set<string>): boolean {
    for (const player of eligible) {
      if (visited.has(player.id) || !isEligibleForSlot(template![slot], player.position)) continue
      visited.add(player.id)
      const previous = assignments.get(player.id)
      if (previous === undefined || assign(previous, visited)) {
        assignments.set(player.id, slot)
        return true
      }
    }
    return false
  }
  const missing = template.filter((_, index) => !assign(index, new Set()))
  return { missing, unknown: false }
}

export function lineupActionability(input: {
  stage: string; eliminated?: boolean; bestBall?: boolean; waiversEnabled?: boolean | null;
  slots?: string[]; players?: CoveragePlayer[]; emptyStarters: number; hurtStarters: number;
}) {
  if (input.eliminated || ['pre_draft', 'setup', 'drafting', 'complete', 'completed', 'offseason'].includes(input.stage)) {
    return { emptyStarters: 0, hurtStarters: 0, bestBallMissing: [] as string[], needsWaivers: false }
  }
  if (input.bestBall) {
    const coverage = bestBallCoverage(input.slots ?? [], input.players ?? [])
    return { emptyStarters: 0, hurtStarters: 0, bestBallMissing: coverage.missing,
      needsWaivers: !coverage.unknown && coverage.missing.length > 0 && input.waiversEnabled === true }
  }
  return { emptyStarters: input.emptyStarters, hurtStarters: input.hurtStarters, bestBallMissing: [] as string[], needsWaivers: false }
}
