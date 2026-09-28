import { getDiscordBridge, type DiscordBridgeData } from '@/lib/core-app/discordBridge'
import { resolveLeagueMembership } from '@/lib/league-access'
import { readLeagueDiscordInvite } from '@/lib/discord/leagueInvite'

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
 *
 * WHO GETS WHICH (owner's decisions, 2026-09-25):
 *   - head commissioner or co-commissioner → `ready`, the setup screen (`getDiscordBridge` applies
 *     `canManageDiscordBridge`, the rule every bridge write route checks);
 *   - any other league member → `not-commissioner`, carrying the league's stored invite so they
 *     get a "Join the league Discord" button and nothing that sets anything up;
 *   - anyone else → `no-league`. The rail gate above should already have dropped them; membership is
 *     checked here again with the canonical predicate because this state hands out an invite link,
 *     and a link that reaches every member must not reach anyone who is not one.
 */
export type DiscordBridgeScreen =
  | { state: 'no-league' }
  | { state: 'ready'; data: DiscordBridgeData }
  | { state: 'not-commissioner'; league: { id: string; name: string }; inviteUrl: string | null }
  | { state: 'unavailable'; league: { id: string; name: string } }

export async function loadDiscordBridgeScreen(
  userId: string,
  league: { id: string; name: string } | null,
): Promise<DiscordBridgeScreen> {
  if (!league) return { state: 'no-league' }
  const scoped = { id: league.id, name: league.name }
  try {
    const data = await getDiscordBridge(userId, league.id)
    // `getDiscordBridge` answers null only when this user does not run the league.
    if (data) return { state: 'ready', data }

    const membership = await resolveLeagueMembership(league.id, userId)
    if (!membership.ok) return { state: 'no-league' }
    return { state: 'not-commissioner', league: scoped, inviteUrl: await readLeagueDiscordInvite(league.id) }
  } catch {
    console.warn('[core/discord] bridge read failed')
    return { state: 'unavailable', league: scoped }
  }
}
