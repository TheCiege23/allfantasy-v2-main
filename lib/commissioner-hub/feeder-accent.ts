/**
 * Commissioner hub — accent resolver.
 *
 * Picks the AccentTone for the outer "multi-league" hub (Tournament or Zombie
 * universe). The tint flows down to the hub header + feeder card grid so the
 * hub inherits the same look the commissioner saw while creating the league.
 */

import type { AccentTone } from '@/lib/create-league-v2/theme'
import { ACCENTS, DEFAULT_ACCENT } from '@/lib/create-league-v2/theme'

type CommissionerHubKind = 'tournament' | 'zombie'

/**
 * Tournament hub is always orange (`ACCENTS.tournament`).
 * Zombie hub is always toxic-green (`ACCENTS.zombie`).
 * Fallback is the default redraft accent.
 */
export function resolveHubAccent(kind: CommissionerHubKind): AccentTone {
  if (kind === 'tournament') return ACCENTS.tournament ?? DEFAULT_ACCENT
  if (kind === 'zombie') return ACCENTS.zombie ?? DEFAULT_ACCENT
  return DEFAULT_ACCENT
}
