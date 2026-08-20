/**
 * Canonical player page link for news and other surfaces (Prompt 131).
 * Opens legacy app with player context so user can see profile/finder.
 */

/** Base URL for legacy app with player context. */
export function getPlayerPageHref(playerName: string): string {
  const q = encodeURIComponent(playerName.trim());
  return `/af-rankings&q=${q}`;
}
