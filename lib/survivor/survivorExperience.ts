/**
 * Rooks vs Vets — pure. Who is new to this league and who is returning, and the cast order a
 * "split by experience" tribe draw deals from.
 *
 * Precedence: the commissioner's manual flag, then this league's own history (the castaway owned a
 * team in an earlier season of the same league — a renewed league keeps its id across seasons), then
 * rookie. Nothing is invented: a castaway with no earlier season on record is a rookie until the
 * commissioner says otherwise.
 */
import type { SurvivorExperience } from './survivorGovernanceSettings'

export type ExperienceSource = 'manual' | 'history' | 'default'

export interface CastawayExperience {
  experience: SurvivorExperience
  source: ExperienceSource
}

export function resolveCastawayExperience(
  userIds: readonly string[],
  overrides: Readonly<Record<string, SurvivorExperience>>,
  returningUserIds: ReadonlySet<string>,
): Record<string, CastawayExperience> {
  const out: Record<string, CastawayExperience> = {}
  for (const userId of userIds) {
    const manual = overrides[userId]
    out[userId] = manual
      ? { experience: manual, source: 'manual' }
      : returningUserIds.has(userId)
        ? { experience: 'veteran', source: 'history' }
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
