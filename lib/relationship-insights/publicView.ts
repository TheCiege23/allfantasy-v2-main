/**
 * publicView — what a relationship-insights caller can return or prompt with about each manager.
 *
 * 🛑 Milestone 32: manager characterisation (labels, trait scores) is shown to nobody. Since 2026-11-19
 * (re-score build item 10) the personality profiles are gone from this path entirely — no profile is read,
 * and storylines rank on rivalry and drama facts alone. What crosses this boundary is facts: which drama
 * involves whom.
 */
import type {
  BehaviorDramaManagerContext,
  PublicBehaviorDramaContext,
} from './types'

export function toPublicBehaviorDramaContext(
  rows: BehaviorDramaManagerContext[]
): PublicBehaviorDramaContext[] {
  return rows.map((row) => ({ managerId: row.managerId, dramaEvents: row.dramaEvents }))
}
