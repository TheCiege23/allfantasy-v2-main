import type { Prisma } from "@prisma/client"

/**
 * What account deletion must RELEASE beyond the AppUser row it anonymizes.
 *
 * /api/user/delete scrubbed email, username, password and display name, and
 * nothing else. Everything keyed to the user survived on an account nobody can
 * sign in to again:
 *
 *  - user_profiles kept the phone number, the Sleeper link, the Discord identity
 *    and email, and LIVE Discord and Spotify access/refresh tokens. That is
 *    personal data and working credentials after "deletion".
 *  - user_profiles.sleeperUserId, .phone and .discordUserId are UNIQUE, so the
 *    deleted account went on OWNING them: a new account could not link the same
 *    Sleeper handle (every import then refused with "Link your Sleeper account"),
 *    re-register the same phone, or connect the same Discord.
 *  - PlatformIdentity rows (unique per platform + platform user id) held the
 *    user's Sleeper/ESPN/Yahoo identities the same way.
 *  - LeagueTeam.claimedByUserId kept the user's claimed teams, so the manager
 *    re-importing under a new account found their own team "already claimed".
 *  - AppUser.legacyUserId kept the Legacy history claimed.
 *  - 🛑 CONNECTED-PLATFORM CREDENTIALS SURVIVED, and the 2026-10 Privacy Policy (§8.4)
 *    promises them deleted: `league_auths` (ESPN espn_s2/SWID cookies, the Fantrax
 *    Secret ID, the MFL API key, Yahoo OAuth tokens), the YahooConnection row, and
 *    database sessions. The FK cascades on all of them only fire on a hard delete,
 *    which this is not. The legacy MFL session (MFLConnection) has no user id at all —
 *    it is keyed by a browser cookie — so the route passes that cookie in when it has one.
 *
 * Leagues themselves are left in place with their anonymized owner, as before:
 * other members may still be in them, and a re-import creates the new account's
 * own League row (one per importer).
 *
 * Runs inside the caller's transaction. Idempotent, so the repair script can
 * run it again over accounts deleted before this existed.
 */
export async function releaseDeletedAccountLinks(
  tx: Prisma.TransactionClient,
  userId: string,
  opts: { mflSessionId?: string | null } = {},
) {
  const profile = await tx.userProfile.updateMany({
    where: { userId },
    data: {
      displayName: null,
      phone: null,
      phoneVerifiedAt: null,
      bio: null,
      sleeperUsername: null,
      sleeperUserId: null,
      sleeperLinkedAt: null,
      sleeperVerifiedAt: null,
      discordUserId: null,
      discordUsername: null,
      discordEmail: null,
      discordAvatar: null,
      discordAccessToken: null,
      discordRefreshToken: null,
      discordConnectedAt: null,
      discordGuildId: null,
      spotifyAccessToken: null,
      spotifyRefreshToken: null,
      spotifyExpiresAt: null,
      spotifyDisplayName: null,
      spotifyConnectedAt: null,
    },
  })
  const identities = await tx.platformIdentity.deleteMany({ where: { userId } })
  const teams = await tx.leagueTeam.updateMany({ where: { claimedByUserId: userId }, data: { claimedByUserId: null } })
  await tx.appUser.update({ where: { id: userId }, data: { legacyUserId: null } })
  // Browser push subscriptions AND the iOS app's device tokens (same table): a deleted
  // account must stop notifying the phone it was on. The row cascade only fires on a
  // hard delete, and deletion here anonymizes the user row instead.
  const pushDevices = await tx.webPushSubscription.deleteMany({ where: { userId } })
  // Credentials are DELETED, never anonymized: a nulled-out row still says which platforms
  // the person used, and there is nothing in one worth keeping for anyone else.
  const platformCredentials = await tx.leagueAuth.deleteMany({ where: { userId } })
  const yahooConnections = await tx.yahooConnection.deleteMany({ where: { userId } })
  const sessions = await tx.authSession.deleteMany({ where: { userId } })
  const mflSessions = opts.mflSessionId
    ? await tx.mFLConnection.deleteMany({ where: { sessionId: opts.mflSessionId } })
    : { count: 0 }
  return {
    profiles: profile.count,
    platformIdentities: identities.count,
    teamsReleased: teams.count,
    pushDevices: pushDevices.count,
    platformCredentials: platformCredentials.count,
    yahooConnections: yahooConnections.count,
    sessions: sessions.count,
    mflSessions: mflSessions.count,
  }
}
