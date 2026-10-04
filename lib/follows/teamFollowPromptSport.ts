import 'server-only'

import { looksLikeDevyFormat } from '@/lib/core-app/devy'

/**
 * Which sport the "follow your teams" prompt opens on (owner's call, 2026-10-03: point it at college
 * fans). College football when any of the account's leagues says the person follows college — an
 * NCAAF league, or a devy / campus-to-canton league, whose whole point is college players — and NFL,
 * the prompt's long-standing default, otherwise. Every other sport stays one tap away in its tabs.
 *
 * Reads only the league list the shell has already loaded — no query. Devy/C2C detection is
 * `looksLikeDevyFormat`, the same check the Devy nav uses, so the two can never disagree.
 */
export function teamFollowPromptSport(
  leagues: ReadonlyArray<{ sport?: string | null; leagueVariant?: string | null; leagueType?: string | null }>,
): 'NCAAF' | 'NFL' {
  const college = leagues.some((l) => String(l.sport ?? '').trim().toUpperCase() === 'NCAAF' || looksLikeDevyFormat(l))
  return college ? 'NCAAF' : 'NFL'
}
