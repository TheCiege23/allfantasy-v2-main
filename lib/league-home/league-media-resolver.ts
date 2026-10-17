/**
 * League homepage — media resolver.
 *
 * Reuses the MP4/poster registries already built for the create-league v2 flow,
 * so the same videos the user saw during creation play in the league hero.
 */

import type { MediaAsset } from '@/lib/create-league-v2/theme'
import { LEAGUE_TYPE_MEDIA, SPORT_MEDIA } from '@/lib/create-league-v2/theme'

export interface ResolvedLeagueMedia {
  /** Primary video (league-type cinematic intro). */
  primary: string
  /** Secondary fallback (sport ambient loop) if the primary 404s. */
  fallback: string
  /** Poster shown while the video loads or if both videos fail. */
  poster: string
}

/**
 * Map a league's format + sport to the right MP4.
 * - Tries the league-type-specific intro first (e.g. league-type-dynasty-intro.mp4)
 * - Falls back to the sport ambient clip (e.g. Football.mp4)
 * - Poster always points to the sport PNG
 */
export function resolveLeagueMedia(
  sport: string,
  leagueType: string | null | undefined,
  variant?: string | null
): ResolvedLeagueMedia {
  const sportKey = String(sport ?? 'NFL').toUpperCase()
  const typeKey = String(leagueType ?? 'redraft').toLowerCase()
  const variantKey = String(variant ?? '').toLowerCase()

  // IDP tweak — use the IDP intro when available
  const effectiveType =
    variantKey === 'idp' || variantKey === 'dynasty_idp' ? 'idp' : typeKey

  const typeMedia: MediaAsset | undefined = LEAGUE_TYPE_MEDIA[effectiveType]
  const sportMedia: MediaAsset | undefined = SPORT_MEDIA[sportKey]

  const primary = typeMedia?.video ?? sportMedia?.video ?? '/af-crest.png'
  const fallback = sportMedia?.video ?? typeMedia?.fallback ?? '/af-crest.png'
  const poster = sportMedia?.poster ?? typeMedia?.fallback ?? '/af-crest.svg'

  return { primary, fallback, poster }
}
