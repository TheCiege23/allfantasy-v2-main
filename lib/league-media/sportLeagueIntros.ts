/**
 * Sport-specific league intros — the clip that plays once, after a league is created.
 *
 * Every concept intro under `LEAGUE_TYPE_MEDIA_MAP` was cut for football, which reads wrong
 * on the six non-NFL sports the platform now supports. These clips are the sport-native
 * alternative, and they only outrank a concept intro for the GENERIC formats below: a Zombie
 * or Guillotine league keeps its own intro, because the concept is the distinctive thing there.
 *
 * Missing entries fail closed (null), so a sport with no shipped clip — NBA and NCAAB today —
 * falls straight through to the concept intro it already had.
 */

import type { SupportedSport } from '@/lib/create-league-v2/state'

/** Shipped under /public/media/league-intros/sports/. NBA + NCAAB have no clip yet. */
const SPORT_INTRO_VIDEO: Partial<Record<SupportedSport, string>> = {
  NFL: '/media/league-intros/sports/Football.mp4',
  NCAAF: '/media/league-intros/sports/Football.mp4',
  MLB: '/media/league-intros/sports/Baseball.mp4',
  NHL: '/media/league-intros/sports/Hockey.mp4',
  SOCCER: '/media/league-intros/sports/Soccer.mp4',
}

/** Poster reuses the packaged create-league sport thumbnails (folder name is `thumbnail`). */
const SPORT_INTRO_POSTER: Partial<Record<SupportedSport, string>> = {
  NFL: '/media/create-league/sports/thumbnail/Football.png',
  NCAAF: '/media/create-league/sports/thumbnail/Football.png',
  MLB: '/media/create-league/sports/thumbnail/Baseball.png',
  NHL: '/media/create-league/sports/thumbnail/Hockey.png',
  SOCCER: '/media/create-league/sports/thumbnail/Soccer.png',
}

const SPORT_INTRO_LABEL: Partial<Record<SupportedSport, string>> = {
  NFL: 'Football',
  NCAAF: 'Football',
  MLB: 'Baseball',
  NHL: 'Hockey',
  SOCCER: 'Soccer',
}

/**
 * Formats whose intro carries no theme of its own, so the sport is the more informative thing
 * to show. Everything absent from this set — zombie, guillotine, survivor, big_brother, c2c,
 * devy, tournament — keeps its concept intro regardless of sport.
 */
export const SPORT_INTRO_ELIGIBLE_CONCEPTS: ReadonlySet<string> = new Set([
  'redraft',
  'dynasty',
  'keeper',
  'best_ball',
  'idp',
  'salary_cap',
])

export type SportLeagueIntro = {
  video: string
  poster: string
  label: string
}

export function normalizeSportKey(raw: unknown): SupportedSport | null {
  const key = String(raw ?? '').trim().toUpperCase()
  if (!key) return null
  return key in SPORT_INTRO_VIDEO || key === 'NBA' || key === 'NCAAB'
    ? (key as SupportedSport)
    : null
}

/**
 * The sport intro for a league, or null when the concept should keep its own.
 * Null covers three separate cases on purpose: no sport, an ineligible (themed) concept,
 * and a sport with no shipped clip.
 */
export function resolveSportLeagueIntro(input: {
  sport: unknown
  conceptKey: string | null | undefined
}): SportLeagueIntro | null {
  const concept = String(input.conceptKey ?? '').trim().toLowerCase()
  if (!SPORT_INTRO_ELIGIBLE_CONCEPTS.has(concept)) return null

  const sport = normalizeSportKey(input.sport)
  if (!sport) return null

  const video = SPORT_INTRO_VIDEO[sport]
  if (!video) return null

  return {
    video,
    poster: SPORT_INTRO_POSTER[sport] ?? '/af-crest.png',
    label: SPORT_INTRO_LABEL[sport] ?? sport,
  }
}
