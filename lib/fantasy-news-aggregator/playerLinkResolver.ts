import { playerProfileHref } from '@/lib/player-links/playerProfileHref';

/**
 * Where a player name on a news item leads (Prompt 131; reworked 2026-11-12).
 *
 * It used to open `/af-rankings?q=<name>` — a redirect into the rankings list filtered by text,
 * not a player page. Now:
 *
 *  - a name the FEED attached to the item (`playerName` / `playerNames`) opens that player's page,
 *    `/player/<name>?sport=` — the profile resolves the name in that sport and asks "which one?"
 *    when namesakes remain (lib/player-links/playerProfileHref.ts);
 *  - a name only GUESSED from the headline text (`extractLikelyPlayerNames`, a capitalised-words
 *    heuristic) opens the Player Finder search, `/core/players?q=`. A guess can be "New England" or
 *    a coach, and a profile page for it would be an empty profile of nobody; a search is honest
 *    about not knowing.
 */
export function getPlayerPageHref(
  playerName: string,
  options: { sport?: string | null; fromFeed?: boolean } = {},
): string {
  const name = playerName.trim();
  const search = `/core/players?q=${encodeURIComponent(name)}`;
  if (options.fromFeed === false) return search;
  return playerProfileHref({ name, sport: options.sport }) ?? search;
}

/** Whether the feed itself named this player, rather than the headline heuristic guessing it. */
export function isFeedNamedPlayer(
  item: { playerName?: string | null; playerNames?: string[] | null },
  name: string,
): boolean {
  const key = name.trim().toLowerCase();
  if (!key) return false;
  if (item.playerName?.trim().toLowerCase() === key) return true;
  return (item.playerNames ?? []).some((n) => n?.trim().toLowerCase() === key);
}

/** The link for one name on one news item. */
export function newsPlayerHref(
  item: { playerName?: string | null; playerNames?: string[] | null; sport?: string | null },
  name: string,
  feedSport?: string | null,
): string {
  return getPlayerPageHref(name, {
    sport: item.sport ?? feedSport ?? null,
    fromFeed: isFeedNamedPlayer(item, name),
  });
}
