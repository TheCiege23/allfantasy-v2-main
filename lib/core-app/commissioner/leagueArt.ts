import { getLeagueTypeMedia, resolveLeagueConceptIntroKey } from '@/lib/league-media/leagueTypeMedia'

/**
 * Key art for a commissioner hub's hero band (five-doors restyle, call 4: art
 * already in the app).
 *
 *   all leagues   the robot king on his throne
 *   one league    that league's own format loop — the same `league-type-*` clip
 *                 and poster league creation shows for the format
 *   redraft       the robot king: redraft has an intro clip, not a loop
 *
 * Client-safe: no Prisma.
 */

export type HubArt = {
  /** Format label for the league, or null when the format is not one we have art for. */
  label: string | null
  video: string | null
  poster: string
}

export const ROBOT_KING_ART: HubArt = { label: null, video: null, poster: '/af-robot-king.png' }

const REDRAFT = getLeagueTypeMedia('redraft')

export function leagueHubArt(league: {
  leagueType?: string | null
  leagueVariant?: string | null
  isDynasty?: boolean | null
  guillotineMode?: boolean | null
  bestBallMode?: boolean | null
  settings?: unknown
}): HubArt {
  const media = getLeagueTypeMedia(resolveLeagueConceptIntroKey(league))
  // An unknown key comes back dressed as redraft; only the real redraft may say so.
  const known = media.key === 'redraft' || media.thumbnail !== REDRAFT.thumbnail
  // Looping format art lives at /league-type-*.mp4; redraft's clip is a one-shot intro.
  const looping = known && media.key !== 'redraft' && media.selectionVideo.startsWith('/league-type-')
  if (!looping) return { ...ROBOT_KING_ART, label: known ? media.label : null }
  return { label: media.label, video: media.selectionVideo, poster: media.thumbnail }
}
