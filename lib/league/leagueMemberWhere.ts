/**
 * Every way a user is IN a league, as one Prisma `OR` list for reads.
 *
 * 🛑 "OWNS IT OR HAS CLAIMED A TEAM" WAS WRITTEN INLINE ABOUT FIFTY TIMES, AND IT IS NOT THE WHOLE
 * ANSWER. Three kinds of member hold no claimed team: a co-owner of a shared team
 * (lib/team-coowners), a league mate with no team who joined an already-imported league as a viewer
 * (lib/league/importViewers.ts), and a co-commissioner who runs the league without playing in it
 * (lib/league/tournamentCoCommissioners.ts). `assertLeagueMember` admits all three; the inline
 * filters did not, so the league opened for them in one place and answered "not a member" in the next.
 *
 * For READS: whether this user may see a league. It says nothing about running a team or being a
 * commissioner; those have their own checks (`rosterManager`, `commissionerAccess`).
 */
import { IMPORT_VIEWERS_KEY } from '@/lib/league/importViewers'
import { IMPORT_CO_COMMISSIONERS_KEY, TOURNAMENT_CO_COMMISSIONERS_KEY } from '@/lib/league/tournamentCoCommissioners'

export function leagueMemberWhere(userId: string) {
  return [
    { userId },
    { teams: { some: { claimedByUserId: userId } } },
    { teamCoOwners: { some: { userId, acceptedAt: { not: null } } } },
    { settings: { path: [IMPORT_VIEWERS_KEY], array_contains: [userId] } },
    { settings: { path: [IMPORT_CO_COMMISSIONERS_KEY], array_contains: [userId] } },
    { settings: { path: [TOURNAMENT_CO_COMMISSIONERS_KEY], array_contains: [userId] } },
  ]
}
