import { prisma } from '@/lib/prisma'

/** Weekly reports have their own approval, pinning and correction workflow. */
const dueWhere = (now: Date) => ({
  isPosted: false,
  scheduledFor: { not: null, lte: now },
  type: { not: 'weekly_update' },
})

/** A delivery receipt commits only with the corresponding chat message or private notification. */
export async function processZombieAnnouncementQueue(): Promise<{ posted: number; errors: string[] }> {
  const now = new Date()
  const due = await prisma.zombieAnnouncement.findMany({
    where: dueWhere(now),
    orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
    take: 100,
    select: { id: true },
  })
  let posted = 0
  const errors: string[] = []
  for (const { id } of due) {
    try {
      const delivered = await prisma.$transaction(async (tx) => {
        // The conditional write locks the row. Concurrent workers recheck this predicate
        // after the winner commits; a failed delivery rolls this claim back too.
        const claim = await tx.zombieAnnouncement.updateMany({
          where: { id, ...dueWhere(now) },
          data: { isPosted: true, postedAt: now },
        })
        if (claim.count !== 1) return false
        const announcement = await tx.zombieAnnouncement.findUniqueOrThrow({
          where: { id },
          include: { league: { select: { leagueId: true } } },
        })
        const leagueId = announcement.league.leagueId
        const sourceKey = `zombie-announcement:${id}`
        if (!announcement.isPublic || announcement.targetUserId) {
          // A target always makes the delivery private, even on an inconsistent old row.
          if (!announcement.targetUserId) throw new Error('Private announcement has no recipient')
          await tx.platformNotification.upsert({
            where: { sourceKey },
            create: {
              sourceKey, userId: announcement.targetUserId, leagueId,
              type: 'zombie_announcement', title: announcement.title,
              body: announcement.content, severity: 'low',
              meta: { leagueId, zombieAnnouncementId: id, week: announcement.week },
            },
            update: {},
          })
        } else {
          const owner = await tx.league.findUnique({ where: { id: leagueId }, select: { userId: true } })
          if (!owner?.userId) throw new Error('League owner is unavailable')
          await tx.leagueChatMessage.upsert({
            where: { id: sourceKey },
            create: {
              id: sourceKey, leagueId, userId: owner.userId, type: 'host_announcement',
              message: `${announcement.title}\n\n${announcement.content}`.slice(0, 100_000),
              metadata: { senderIsHost: true, contentType: 'host_announcement', zombieAnnouncementId: id, week: announcement.week },
            },
            update: {},
          })
        }
        return true
      })
      if (delivered) posted += 1
    } catch {
      // Do not return private content from a Prisma error in the cron response.
      // One failed recipient must not prevent delivery to the rest of the queue.
      errors.push(`announcement ${id}: delivery failed; pending retry`)
    }
  }
  return { posted, errors }
}
