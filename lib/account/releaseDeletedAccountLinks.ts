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
 *
 * Leagues themselves are left in place with their anonymized owner, as before:
 * other members may still be in them, and a re-import creates the new account's
 * own League row (one per importer).
 *
 * Runs inside the caller's transaction. Idempotent, so the repair script can
 * run it again over accounts deleted before this existed.
 */
export async function releaseDeletedAccountLinks(tx: Prisma.TransactionClient, userId: string) {
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
  return { profiles: profile.count, platformIdentities: identities.count, teamsReleased: teams.count }
}
