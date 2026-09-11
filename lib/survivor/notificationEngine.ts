import { prisma } from '@/lib/prisma'

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
      /* Keyed on the claim — see leagueMemberIds: `isOrphan` cannot express "departed". */
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

  for (const n of pending) {
    try {
      const userIds = await resolveRecipientUserIds(leagueId, n.recipientUserId, n.recipientRole)
      const title =
        !n.isSpoilerSafe
          ? 'Something happened on the Island'
          : n.title
      const body =
        !n.isSpoilerSafe ? 'Open the app to find out.' : n.body

      for (const uid of userIds) {
        await prisma.platformNotification.create({
          data: {
            userId: uid,
            type: `survivor:${n.type}`,
            title,
            body,
            severity: n.urgency === 'critical' ? 'high' : n.urgency === 'high' ? 'medium' : 'low',
            productType: 'sports',
            meta: {
              leagueId,
              survivorNotificationId: n.id,
              deepLinkPath: n.deepLinkPath,
            } as object,
          },
        })
      }

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
  await scheduleIfFuture(leagueId, 'vote_reminder', {
    recipientRole: 'active',
    title: '🗳 Vote closes in 2 hours',
    body: 'Tribal Council deadline approaching. Cast your vote via @Chimmy.',
    deepLinkPath: `/survivor/${leagueId}/tribal`,
    urgency: 'high',
    isSpoilerSafe: true,
    scheduledFor: new Date(deadline.getTime() - 2 * 60 * 60 * 1000),
  })
  await scheduleIfFuture(leagueId, 'vote_reminder', {
    recipientRole: 'active',
    title: '⚠️ 30 minutes to vote',
    body: 'Tribal Council is closing soon. Have you voted?',
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

export async function notifyIdolAssigned(leagueId: string, userId: string): Promise<void> {
  await enqueueNotification(leagueId, 'idol_received', {
    recipientUserId: userId,
    title: '🔮 You received a secret power',
    body: 'Check your @Chimmy private chat for details.',
    deepLinkPath: `/survivor/${leagueId}/chimmy`,
    urgency: 'high',
    isSpoilerSafe: true,
  })
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
