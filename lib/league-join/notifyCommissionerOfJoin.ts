import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'

/**
 * Tells the league owner a manager joined, with the fill count: "Steve joined The Ciege NBA Guilly —
 * 3/16 spots filled". Commissioner alerts are a push category, so this reaches their phone under
 * their own notification settings.
 *
 * Counted from claimed teams, the same claim that makes someone a member, so the number matches the
 * league page. Best-effort: the join has already committed, and a failed alert must not fail it.
 */
export async function notifyCommissionerOfJoin(params: { leagueId: string; joinerUserId: string }): Promise<void> {
  const { leagueId, joinerUserId } = params
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { name: true, userId: true, leagueSize: true },
  })
  if (!league?.userId || league.userId === joinerUserId) return

  const [filled, totalTeams, profile] = await Promise.all([
    prisma.leagueTeam.count({ where: { leagueId, claimedByUserId: { not: null } } }),
    prisma.leagueTeam.count({ where: { leagueId } }),
    prisma.userProfile.findFirst({ where: { userId: joinerUserId }, select: { displayName: true, sleeperUsername: true } }),
  ])
  const size = league.leagueSize ?? totalTeams
  const who = profile?.displayName?.trim() || profile?.sleeperUsername?.trim() || 'A new manager'
  const leagueName = league.name?.trim() || 'your league'
  const count = size > 0 ? `${filled}/${size} spots filled` : `${filled} managers joined`
  const full = size > 0 && filled >= size

  await dispatchNotification({
    userIds: [league.userId],
    category: 'commissioner_alerts',
    type: 'league_member_joined',
    title: `${who} joined ${leagueName}`,
    body: full ? `${count}. Your league is full.` : `${count}.`,
    actionHref: `/league/${leagueId}`,
    actionLabel: 'Open league',
    leagueId,
    meta: { joinerUserId, filled, size },
    severity: 'low',
    dedupePrefix: `league_member_joined:${leagueId}:${joinerUserId}`,
  })
}
