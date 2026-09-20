/**
 * Hero clips for the bracket-challenge create flow, keyed by sport.
 *
 * Deliberately sparse. Only the sports with shipped artwork appear, and everything else resolves
 * to `null` so the create page renders exactly as it did before — one sport is on screen at a
 * time there, so a missing hero reads as "no hero", not as a gap beside its neighbours.
 *
 * ⚠ Add a sport here only once its art actually ships. MLB is a LIVE playoff sport with no
 * artwork yet (see `playoffPoolHref` in app/brackets/page.tsx); listing it with a placeholder
 * would put a broken <video> on a working create flow.
 */

export type BracketChallengeHero = {
  video: string
  poster: string
  /** Used for the accessible label; the visible copy already names the sport. */
  label: string
}

const HERO_BY_SPORT: Record<string, BracketChallengeHero> = {
  NBA: {
    video: '/videos/brackets/nba-playoffs/af-nba-playoffs-hero.mp4',
    poster: '/images/brackets/nba-playoffs/af-nba-playoffs-hero-poster.png',
    label: 'NBA Playoff Bracket Challenge',
  },
  NHL: {
    video: '/videos/brackets/nhl-playoffs/af-nhl-playoffs-hero.mp4',
    poster: '/images/brackets/nhl-playoffs/af-nhl-playoffs-hero-poster.png',
    label: 'NHL Playoff Bracket Challenge',
  },
}

/** Hero for a sport, or null when none ships. Fails closed on junk input. */
export function resolveBracketChallengeHero(sport: unknown): BracketChallengeHero | null {
  const key = String(sport ?? '').trim().toUpperCase()
  if (!key) return null
  return HERO_BY_SPORT[key] ?? null
}

/** Sports with a shipped hero — exported for tests and asset checks. */
export function bracketChallengeHeroSports(): readonly string[] {
  return Object.keys(HERO_BY_SPORT)
}
