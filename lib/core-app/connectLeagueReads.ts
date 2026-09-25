import 'server-only'

import { isUserVerified } from '@/lib/auth-guard'
import { prisma } from '@/lib/prisma'
import { currentFantasySeason, type ConnectLeagueFacts } from './connectLeague'

/**
 * The three small reads behind the home's "connect your league" card (see connectLeague.ts). The
 * league count is the home's own — passed in, never re-read — so the card and the rail beside it
 * cannot disagree about whether this person has leagues.
 *
 * Fails CLOSED: any error reads as "we know your team", so a database blip hides the card rather than
 * telling a manager with twelve leagues to go connect one.
 */
export async function loadConnectLeagueFacts(
  userId: string,
  leagueCount: number,
  now: Date = new Date(),
): Promise<(ConnectLeagueFacts & { sleeperLinked: boolean }) | null> {
  try {
    const [claimedTeams, user, profile] = await Promise.all([
      prisma.leagueTeam.count({
        where: { claimedByUserId: userId, league: { season: { gte: currentFantasySeason(now) } } },
      }),
      prisma.appUser.findUnique({ where: { id: userId }, select: { emailVerified: true } }),
      prisma.userProfile.findUnique({ where: { userId }, select: { phoneVerifiedAt: true, sleeperUserId: true } }),
    ])
    return {
      claimedTeams,
      leagueCount,
      verified: isUserVerified(user?.emailVerified ?? null, profile?.phoneVerifiedAt ?? null),
      sleeperLinked: Boolean(profile?.sleeperUserId),
    }
  } catch {
    return null
  }
}
