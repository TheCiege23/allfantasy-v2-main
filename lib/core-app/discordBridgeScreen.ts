import { getDiscordBridge, type DiscordBridgeData } from '@/lib/core-app/discordBridge'

/**
 * What `/core/discord` shows, decided in one place.
 *
 * ⚠ FOUR STATES, NOT "DATA OR NULL". The page used to `.catch(() => null)` and render one panel
 * for every null — "Pick a league you commission from the rail." — so a commissioner whose read
 * FAILED was told to pick the league already in the URL (it read as though `?league=` had been
 * dropped), and a member who does not run the league got the same words (E2/E6, 2026-09-25).
 *
 * `league` is the rail row for `?league=`: the page has already redirected away an id the user
 * cannot see, so a non-null league here is one they play in, and every state below is scoped to it.
 */
export type DiscordBridgeScreen =
  | { state: 'no-league' }
  | { state: 'ready'; data: DiscordBridgeData }
  | { state: 'not-commissioner'; league: { id: string; name: string } }
  | { state: 'unavailable'; league: { id: string; name: string } }

export async function loadDiscordBridgeScreen(
  userId: string,
  league: { id: string; name: string } | null,
): Promise<DiscordBridgeScreen> {
  if (!league) return { state: 'no-league' }
  const scoped = { id: league.id, name: league.name }
  try {
    const data = await getDiscordBridge(userId, league.id)
    // `getDiscordBridge` answers null only when this user is not the league's owner-commissioner.
    return data ? { state: 'ready', data } : { state: 'not-commissioner', league: scoped }
  } catch {
    console.warn('[core/discord] bridge read failed')
    return { state: 'unavailable', league: scoped }
  }
}
