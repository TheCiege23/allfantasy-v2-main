import { getLeagueRole, isCommissionerRole } from '@/lib/league/permissions'

/**
 * Who may set up a league's Discord: the head commissioner AND co-commissioners (owner's decision,
 * 2026-09-25). Plain members, viewers and anyone outside the league may not.
 *
 * ⚠ ONE RULE, NOT A COPY. This is `getLeagueRole` + `isCommissionerRole` — the same predicate
 * `requireCommissionerRole` gates every league-settings route with, and the same two roles
 * `lib/commissioner/broadcastAccess.ts` lets send. It used to be `league.userId === userId`, typed
 * out separately in five places (the setup screen's data, PATCH, channels/create, guilds/link and
 * bot-install); a sixth copy is how a screen offers a control its route then refuses.
 *
 * 🛑 EVERY BRIDGE WRITE AND THE SCREEN THAT OFFERS IT CALL THIS. Which Discord SERVER someone may
 * use is a different question with its own check (`DiscordGuildLink.linkedByUserId`, verified
 * against Discord at install) and is deliberately left per-person: a co-commissioner can set the
 * league up in a server THEY run, not in one somebody else added AllFantasy to.
 */
export async function canManageDiscordBridge(leagueId: string, userId: string): Promise<boolean> {
  return isCommissionerRole(await getLeagueRole(leagueId, userId))
}
