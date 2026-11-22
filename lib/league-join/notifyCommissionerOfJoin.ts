import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { resolveGuillotineEffectiveSeats } from '@/lib/guillotine/lateStartSeats'

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

  const [filled, totalTeams, profile, guillotineSeats] = await Promise.all([
    prisma.leagueTeam.count({ where: { leagueId, claimedByUserId: { not: null } } }),
    prisma.leagueTeam.count({ where: { leagueId } }),
    prisma.userProfile.findFirst({ where: { userId: joinerUserId }, select: { displayName: true, sleeperUsername: true } }),
    // A native guillotine league's size is the seats its remaining chop weeks support at the
    // scheduled draft time, which can be fewer than the configured size on a late start.
    resolveGuillotineEffectiveSeats(leagueId).catch(() => null),
  ])
  const size = guillotineSeats ?? league.leagueSize ?? totalTeams
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

/**
 * "Sam joined Dynasty Bros from your invite" — to the leaguemate whose invite link brought them
 * (2026-11-15: "build the league-moment alerts").
 *
 * The commissioner hears every join (above); the leaguemate who actually shared the link heard nothing,
 * although their invite carries their referral code (lib/referral/referralShareLink.ts). The referral
 * records who brought this person, so this tells THAT person — and only when they play in this league
 * themselves, which is what makes "from your invite" true. A commissioner who referred them is already
 * told above, so is not told twice. Once per league and joiner.
 *
 * Bell and phone only (`league_announcements`, low severity: no text, and no email for good news that
 * is not time-sensitive). Best-effort, like the commissioner's alert.
 */
export async function notifyInviterOfJoin(params: { leagueId: string; joinerUserId: string }): Promise<void> {
  const { leagueId, joinerUserId } = params
  const referral = await prisma.referral.findUnique({ where: { referredUserId: joinerUserId }, select: { referrerId: true } })
  const inviter = referral?.referrerId
  if (!inviter || inviter === joinerUserId) return
  const [league, inviterTeam, profile] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { name: true, userId: true } }),
    prisma.leagueTeam.findFirst({ where: { leagueId, claimedByUserId: inviter }, select: { id: true } }),
    prisma.userProfile.findFirst({ where: { userId: joinerUserId }, select: { displayName: true, sleeperUsername: true } }),
  ])
  if (!league || league.userId === inviter || !inviterTeam) return
  const who = profile?.displayName?.trim() || profile?.sleeperUsername?.trim() || 'Your friend'
  const leagueName = league.name?.trim() || 'your league'
  await dispatchNotification({
    userIds: [inviter],
    category: 'league_announcements',
    type: 'league_invite_accepted',
    title: `${who} joined ${leagueName}`,
    body: 'They joined from your invite. Say hello in the league chat.',
    actionHref: `/league/${leagueId}`,
    actionLabel: 'Open league',
    leagueId,
    meta: { joinerUserId },
    severity: 'low',
    skipChannels: { email: true, sms: true },
    dedupePrefix: `league_invite_accepted:${leagueId}:${joinerUserId}`,
  })
}

/**
 * "Sam joined Dynasty Bros — 5 of 12 managers are here" — to every OTHER manager already in the league
 * (owner's ask, 2026-11-21: league mates arriving from Sleeper and Fantrax should not feel alone, and
 * the people already here should hear when one more shows up).
 *
 * 🛑 A LEAGUE MATE WHO IMPORTED THE SAME LEAGUE ARRIVED IN SILENCE. An import that finds the league
 * already here joins that copy by claiming the importer's own team (`claimExistingLeagueForMember`),
 * and told nobody: not the commissioner, not the managers already in it. Only the invite-link door
 * (`app/api/leagues/join`) sent an alert, and only to the commissioner and the inviter.
 *
 * Sent to the claimed managers other than the joiner. The league owner and the inviter are skipped:
 * they get their own, more specific line above, and nobody is told twice. Bell and phone only, low
 * severity, once per league, joiner and recipient. Best-effort: the join has already committed.
 */
export async function notifyLeagueMatesOfJoin(params: { leagueId: string; joinerUserId: string }): Promise<void> {
  const { leagueId, joinerUserId } = params
  const [league, teams, profile, referral] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { name: true, userId: true } }),
    prisma.leagueTeam.findMany({ where: { leagueId }, select: { claimedByUserId: true } }),
    prisma.userProfile.findFirst({ where: { userId: joinerUserId }, select: { displayName: true, sleeperUsername: true } }),
    prisma.referral.findUnique({ where: { referredUserId: joinerUserId }, select: { referrerId: true } }).catch(() => null),
  ])
  if (!league) return
  const here = [...new Set(teams.map((t) => t.claimedByUserId).filter((id): id is string => Boolean(id)))]
  const skip = new Set([joinerUserId, league.userId, referral?.referrerId].filter((id): id is string => Boolean(id)))
  const recipients = here.filter((id) => !skip.has(id))
  if (recipients.length === 0) return
  const who = profile?.displayName?.trim() || profile?.sleeperUsername?.trim() || 'A league mate'
  const leagueName = league.name?.trim() || 'your league'
  const missing = teams.length - here.length
  await dispatchNotification({
    userIds: recipients,
    category: 'league_announcements',
    type: 'league_mate_joined',
    title: `${who} joined ${leagueName}`,
    body: missing > 0
      ? `${here.length} of ${teams.length} managers are here now. Invite the other ${missing} from the league page.`
      : `All ${teams.length} managers are here now.`,
    actionHref: `/league/${leagueId}`,
    actionLabel: 'Open league',
    leagueId,
    meta: { joinerUserId, here: here.length, teams: teams.length },
    severity: 'low',
    skipChannels: { email: true, sms: true },
    dedupePrefix: `league_mate_joined:${leagueId}:${joinerUserId}`,
  })
}
