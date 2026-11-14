/**
 * SportPrestigeResolver — sport normalization and labels for the career prestige layer.
 * Re-exports from prestige-governance / sport-scope for single import.
 */

import { normalizeSportForPrestige } from '@/lib/prestige-governance/SportPrestigeResolver'
import { DEFAULT_SPORT } from '@/lib/sport-scope'

export function resolveSportForCareer(sport: string | null | undefined): string {
  return sport ? normalizeSportForPrestige(sport) : DEFAULT_SPORT
}
