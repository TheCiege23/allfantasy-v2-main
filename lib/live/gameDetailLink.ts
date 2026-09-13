import { GAME_VIEW_SPORTS } from '@/lib/live/espnGameSummary'

/**
 * Where a score card links for its clicked-game view, or null for no link.
 *
 * Only ESPN-sourced cards in a covered sport link: another feed's row carries
 * another vendor's id, and a link to a view that can only fail is worse than no
 * link. `base` is the page the view opens on — `/core/live` or `/live` — so no
 * new route is involved (the repo is at its route ceiling).
 */
export function gameDetailHref(
  game: { sport: string; gameId: string; espnDetail?: boolean },
  base: '/core/live' | '/live',
): string | null {
  if (!game.espnDetail || !GAME_VIEW_SPORTS.includes(game.sport) || !/^\d{5,12}$/.test(game.gameId)) return null
  return `${base}?sport=${encodeURIComponent(game.sport)}&game=${encodeURIComponent(game.gameId)}`
}
