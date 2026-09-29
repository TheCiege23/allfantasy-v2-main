/**
 * publicView — the projection between the psychological-profile engine and
 * anything a relationship-insights caller can return or prompt with.
 *
 * 🛑 Milestone 32: manager characterisation (labels, trait scores, the
 * behaviour-heat composite built from them) is shown to nobody. The engine keeps
 * using profiles internally to rank storylines; what crosses this boundary is
 * coverage (a profile exists) and facts (which drama involves whom).
 */
import type { ManagerPsychProfileView } from '@/lib/psychological-profiles/ManagerBehaviorQueryService'
import type {
  BehaviorDramaManagerContext,
  PublicBehaviorDramaContext,
  PublicProfileCoverage,
} from './types'

export function toPublicProfileCoverage(profiles: ManagerPsychProfileView[]): PublicProfileCoverage[] {
  return profiles.map((p) => ({ id: p.id, managerId: p.managerId }))
}

export function toPublicBehaviorDramaContext(
  rows: BehaviorDramaManagerContext[]
): PublicBehaviorDramaContext[] {
  return rows.map((row) => ({ managerId: row.managerId, dramaEvents: row.dramaEvents }))
}
