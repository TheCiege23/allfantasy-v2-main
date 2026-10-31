import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'
import { isSeatPlaceholderUserId } from '@/lib/orphan-ai-manager/orphan-platform-ids'
import {
  isSurvivorNotificationKind,
  renderSurvivorNotificationEmail,
  SURVIVOR_NOTIFICATION_SPECS,
  survivorNotificationCopy,
  type SurvivorNotificationInput,
} from './survivorNotificationCatalog'

export type EnqueueNotificationInput = {
  recipientUserId?: string
  recipientRole?: string
  title: string
  body: string
  deepLinkPath?: string
  urgency?: string
  isSpoilerSafe?: boolean
  scheduledFor?: Date
}

export async function enqueueNotification(
  leagueId: string,
  type: string,
  options: EnqueueNotificationInput,
): Promise<string> {
  const when = options.scheduledFor ?? new Date()
  const row = await prisma.survivorNotification.create({
    data: {
      leagueId,
      type,
      recipientUserId: options.recipientUserId,
      recipientRole: options.recipientRole,
      title: options.title,
      body: options.body,
      deepLinkPath: options.deepLinkPath,
      urgency: options.urgency ?? 'medium',
      isSpoilerSafe: options.isSpoilerSafe ?? true,
      scheduledFor: when,
      status: 'pending',
    },
  })
  return row.id
}

async function resolveRecipientUserIds(
  leagueId: string,
  recipientUserId?: string | null,
  recipientRole?: string | null,
): Promise<string[]> {
  if (recipientUserId) return [recipientUserId]
  if (!recipientRole || recipientRole === 'all') {
    const teams = await prisma.leagueTeam.findMany({
      where: { leagueId, claimedByUserId: { not: null } },
      select: { claimedByUserId: true },
    })
    return [...new Set(teams.map((t) => t.claimedByUserId).filter(Boolean))] as string[]
  }
  if (recipientRole === 'commissioner') {
    const t = await prisma.leagueTeam.findFirst({
      where: { leagueId, isCommissioner: true },
      select: { claimedByUserId: true },
    })
    return t?.claimedByUserId ? [t.claimedByUserId] : []
  }
  const where =
    recipientRole === 'active'
      ? { leagueId, playerState: 'active' as const }
      : recipientRole === 'exile'
        ? { leagueId, playerState: 'exile' as const }
        : recipientRole === 'jury'
          ? { leagueId, isJuryMember: true }
          : { leagueId }
  const players = await prisma.survivorPlayer.findMany({
    where,
    select: { userId: true },
  })
  return players.map((p) => p.userId)
}

/**
 * Marks queue rows due for send, creates `PlatformNotification` per recipient, updates status.
 */
export async function processNotificationQueue(leagueId: string): Promise<{ sent: number; failed: number }> {
  const now = new Date()
  // A reminder that missed its moment ("votes close in 30 minutes") is worse
  // than none, so anything this far past due is retired instead of sent.
  await prisma.survivorNotification.updateMany({
    where: { leagueId, status: 'pending', scheduledFor: { lt: new Date(now.getTime() - STALE_NOTIFICATION_MS) } },
    data: { status: 'expired' },
  })
  const pending = await prisma.survivorNotification.findMany({
    where: {
      leagueId,
      status: 'pending',
      OR: [{ scheduledFor: { lte: now } }, { scheduledFor: null }],
    },
    take: 200,
  })

  let sent = 0
  let failed = 0
  let leagueFacts: { name: string; sport: string | null } | null = null

  for (const n of pending) {
    // Claim the row first so overlapping ticks never deliver it twice.
    const claimed = await prisma.survivorNotification.updateMany({
      where: { id: n.id, status: 'pending' },
      data: { status: 'sending' },
    })
    if (claimed.count !== 1) continue
    try {
      // Vote reminders go only to managers who can vote and have not (survivor-core §5).
      // Castaways Chimmy runs have no account: a notification row needs one, and one failing row would
      // fail the whole league notice. Chimmy needs no alert to play.
      const userIds = (VOTE_REMINDER_TYPES.has(n.type) && !n.recipientUserId
        ? await resolveVoteReminderRecipients(leagueId)
        : await resolveRecipientUserIds(leagueId, n.recipientUserId, n.recipientRole)).filter(id => !isSeatPlaceholderUserId(id))
      const title =
        !n.isSpoilerSafe
          ? 'Something happened on the Island'
          : n.title
      const body =
        !n.isSpoilerSafe ? 'Open the app to find out.' : n.body
      let emailOverride: { subject: string; html: string } | undefined
      if (isSurvivorNotificationKind(n.type) && n.isSpoilerSafe) {
        const facts: { name: string; sport: string | null } = leagueFacts ?? await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true, sport: true } })
          .then(row => ({ name: row?.name ?? 'Survivor league', sport: row?.sport ? String(row.sport) : null }))
        leagueFacts = facts
        emailOverride = renderSurvivorNotificationEmail(n.type, { title, body, leagueId, leagueName: facts.name, sport: facts.sport, baseUrl: getPublicSiteOrigin() })
      }

      // In-app plus email and push, each gated by the recipient's own notification settings.
      await dispatchNotification({
        userIds,
        category: n.recipientRole === 'commissioner' || COMMISSIONER_TYPES.has(n.type) ? 'commissioner_alerts' : 'league_announcements',
        type: `survivor:${n.type}`,
        title,
        body,
        actionHref: n.deepLinkPath ?? `/survivor/${leagueId}`,
        actionLabel: 'Open Survivor',
        leagueId,
        severity: n.urgency === 'critical' ? 'high' : n.urgency === 'high' ? 'medium' : 'low',
        dedupePrefix: `survivor:${n.id}`,
        meta: { leagueId, survivorNotificationId: n.id, deepLinkPath: n.deepLinkPath },
        ...(emailOverride ? { emailOverride } : {}),
      })

      await prisma.survivorNotification.update({
        where: { id: n.id },
        data: { status: 'sent', sentAt: new Date() },
      })
      sent += 1
    } catch (e) {
      failed += 1
      await prisma.survivorNotification.update({
        where: { id: n.id },
        data: {
          status: 'failed',
          errorMessage: e instanceof Error ? e.message : 'error',
        },
      })
    }
  }

  return { sent, failed }
}

const STALE_NOTIFICATION_MS = 24 * 60 * 60 * 1000
const COMMISSIONER_TYPES = new Set(['draft_cast_incomplete', 'tribe_shuffle_recommendation'])
const VOTE_REMINDER_TYPES = new Set(['votes_close_soon', 'vote_reminder'])

/**
 * Who a vote reminder reaches: active managers in the tribe at the open council (everyone active
 * after the merge) who have not cast a ballot. Ballots are read only to know WHETHER someone voted;
 * nothing about a ballot reaches the copy. No open council, no reminder.
 */
export async function resolveVoteReminderRecipients(leagueId: string): Promise<string[]> {
  const council = await prisma.survivorTribalCouncil.findFirst({
    where: { leagueId, closedAt: null, isRevealed: false },
    orderBy: { createdAt: 'desc' },
    select: { id: true, attendingTribeId: true },
  })
  if (!council) return []
  const [players, ballots] = await Promise.all([
    prisma.survivorPlayer.findMany({
      where: { leagueId, playerState: 'active', ...(council.attendingTribeId ? { tribeId: council.attendingTribeId } : {}) },
      select: { userId: true, redraftRosterId: true },
    }),
    prisma.survivorVote.findMany({ where: { councilId: council.id }, select: { voterRosterId: true } }),
  ])
  const voted = new Set(ballots.map(b => b.voterRosterId))
  return [...new Set(players.filter(p => !p.redraftRosterId || !voted.has(p.redraftRosterId)).map(p => p.userId))]
}

/**
 * Queue one of the eight survivor-core notifications with its catalogue copy. `scheduledFor` in the
 * past or omitted means now; a future time is held in the queue like the vote reminders.
 */
export async function enqueueSurvivorCoreNotification(
  leagueId: string,
  input: SurvivorNotificationInput,
  recipient: { userId: string } | { role: 'all' | 'active' | 'jury' },
  scheduledFor?: Date,
): Promise<string> {
  const copy = survivorNotificationCopy(input)
  const spec = SURVIVOR_NOTIFICATION_SPECS[input.kind]
  return enqueueNotification(leagueId, input.kind, {
    ...('userId' in recipient ? { recipientUserId: recipient.userId } : { recipientRole: recipient.role }),
    title: copy.title,
    body: copy.body,
    deepLinkPath: spec.path(leagueId),
    urgency: spec.urgency,
    isSpoilerSafe: true,
    scheduledFor,
  })
}

/** Runs inside the score-sync cron slot: delivers due Survivor notifications for every league. */
export async function processDueSurvivorNotifications(now = new Date()): Promise<{ leagues: number; sent: number; failed: number }> {
  const due = await prisma.survivorNotification.findMany({
    where: { status: 'pending', OR: [{ scheduledFor: { lte: now } }, { scheduledFor: null }] },
    select: { leagueId: true },
    distinct: ['leagueId'],
    take: 50,
  })
  let sent = 0
  let failed = 0
  for (const { leagueId } of due) {
    try {
      const result = await processNotificationQueue(leagueId)
      sent += result.sent
      failed += result.failed
    } catch {
      failed++
    }
  }
  return { leagues: due.length, sent, failed }
}

const REMINDER_BUFFER_MS = 60_000

async function scheduleIfFuture(
  leagueId: string,
  type: string,
  options: EnqueueNotificationInput,
): Promise<void> {
  const when = options.scheduledFor ?? new Date()
  if (when.getTime() <= Date.now() + REMINDER_BUFFER_MS) {
    return
  }
  await enqueueNotification(leagueId, type, { ...options, scheduledFor: when })
}

/**
 * Queues 2h and 30m vote reminders before `deadline`. Skips any slot already in the past.
 */
export async function scheduleTribalReminders(leagueId: string, deadline: Date): Promise<void> {
  const twoHours = survivorNotificationCopy({ kind: 'votes_close_soon' })
  await scheduleIfFuture(leagueId, 'votes_close_soon', {
    recipientRole: 'active',
    title: twoHours.title,
    body: twoHours.body,
    deepLinkPath: SURVIVOR_NOTIFICATION_SPECS.votes_close_soon.path(leagueId),
    urgency: 'high',
    isSpoilerSafe: true,
    scheduledFor: new Date(deadline.getTime() - 2 * 60 * 60 * 1000),
  })
  await scheduleIfFuture(leagueId, 'vote_reminder', {
    recipientRole: 'active',
    title: '⚠️ 30 minutes to vote',
    body: 'Elimination Council is closing soon. Have you voted?',
    deepLinkPath: `/survivor/${leagueId}/tribal`,
    urgency: 'critical',
    isSpoilerSafe: true,
    scheduledFor: new Date(deadline.getTime() - 30 * 60 * 1000),
  })
}

export async function notifyChallengePosted(
  leagueId: string,
  _challengeId: string,
  challengeTitle: string,
  locksAt: Date,
  _scope: string,
): Promise<void> {
  const rel =
    locksAt.getTime() > Date.now()
      ? `closes ${Math.max(0, Math.round((locksAt.getTime() - Date.now()) / 60000))}m`
      : 'soon'
  await enqueueNotification(leagueId, 'challenge_posted', {
    recipientRole: 'active',
    title: '⚡ New Island Challenge',
    body: `${challengeTitle} — ${rel}`,
    deepLinkPath: `/survivor/${leagueId}/challenges`,
    urgency: 'medium',
    isSpoilerSafe: true,
  })
  await enqueueNotification(leagueId, 'challenge_closing', {
    recipientRole: 'active',
    title: '⚡ Challenge closing soon',
    body: `${challengeTitle} — submit before the lock.`,
    deepLinkPath: `/survivor/${leagueId}/challenges`,
    urgency: 'high',
    scheduledFor: new Date(locksAt.getTime() - 60 * 60 * 1000),
  })
}

/** "You found an idol" (survivor-core §5): never names the idol, in push or email. */
export async function notifyIdolAssigned(leagueId: string, userId: string): Promise<void> {
  await enqueueSurvivorCoreNotification(leagueId, { kind: 'idol_found' }, { userId })
}

export async function notifyMerge(leagueId: string): Promise<void> {
  await enqueueNotification(leagueId, 'merge_announced', {
    recipientRole: 'all',
    title: '🌊 The merge has arrived',
    body: 'Drop your buffs. The individual game begins now.',
    urgency: 'critical',
    isSpoilerSafe: false,
  })
}

export async function notifyElimination(leagueId: string, eliminatedName: string, week: number): Promise<void> {
  await enqueueNotification(leagueId, 'elimination', {
    recipientRole: 'all',
    title: '🔥 The tribe has spoken',
    body: `${eliminatedName} has been voted out — Week ${week}.`,
    urgency: 'high',
    isSpoilerSafe: false,
  })
}
