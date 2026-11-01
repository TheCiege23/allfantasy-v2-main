/**
 * Rooks vs Vets — pure. Who is new to this league and who is returning, and the cast order a
 * "split by experience" tribe draw deals from.
 *
 * Precedence: the commissioner's manual flag, then this league's own history (the castaway owned a
 * team in an earlier season of the same league — a renewed league keeps its id across seasons), then
 * — only when the commissioner opted in (`experienceCrossLeague`) — a previous Survivor season in any
 * other AllFantasy league (`platform`; which league is never recorded here), then rookie. Nothing is invented: a castaway with no earlier season on record is a rookie until the
 * commissioner says otherwise.
 */
import type { SurvivorExperience } from './survivorGovernanceSettings'

export type ExperienceSource = 'manual' | 'history' | 'platform' | 'default'

export interface CastawayExperience {
  experience: SurvivorExperience
  source: ExperienceSource
}

export function resolveCastawayExperience(
  userIds: readonly string[],
  overrides: Readonly<Record<string, SurvivorExperience>>,
  returningUserIds: ReadonlySet<string>,
  /** Played Survivor in another AllFantasy league (opt-in lookup); empty when the lookup is off. */
  platformVeteranUserIds: ReadonlySet<string> = new Set(),
): Record<string, CastawayExperience> {
  const out: Record<string, CastawayExperience> = {}
  for (const userId of userIds) {
    const manual = overrides[userId]
    out[userId] = manual
      ? { experience: manual, source: 'manual' }
      : returningUserIds.has(userId)
        ? { experience: 'veteran', source: 'history' }
        : platformVeteranUserIds.has(userId)
          ? { experience: 'veteran', source: 'platform' }
          : { experience: 'rookie', source: 'default' }
  }
  return out
}

/** Rookies first, veterans last, each group keeping the order it came in (already shuffled). */
export function experienceSplitOrder(orderedUserIds: readonly string[], experience: Readonly<Record<string, SurvivorExperience>>): string[] {
  const rookies = orderedUserIds.filter((id) => experience[id] !== 'veteran')
  const vets = orderedUserIds.filter((id) => experience[id] === 'veteran')
  return [...rookies, ...vets]
}

/** Balanced tribe sizes (within one) for a block fill when no capacities are configured. */
export function balancedSizes(total: number, tribeCount: number): number[] {
  const base = Math.floor(total / tribeCount)
  const extra = total % tribeCount
  return Array.from({ length: tribeCount }, (_, i) => base + (i < extra ? 1 : 0))
}
