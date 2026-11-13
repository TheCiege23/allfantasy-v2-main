import 'server-only'
import { prisma } from '@/lib/prisma'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import type { SeasonStageManifest } from './seasonNativeContract'

type Dispatch = typeof import('@/lib/notifications/NotificationDispatcher').dispatchNotification

export async function remindSeasonDraft(input: {
  tournamentId: string
  leagueId: string
  sessionId: string
  pool: SeasonStageManifest['leagues'][number]
  startsAt: string
  now: Date
}, dispatch?: Dispatch) {
  const { tournamentId, leagueId, sessionId, pool, startsAt, now } = input
  const remaining = Date.parse(startsAt) - now.getTime()
  if (remaining <= 0 || remaining > 60 * 60_000) return
  const id = seasonResourceId(sessionId, 'hour-before-draft:' + startsAt)
  if (await prisma.tournamentAuditLog.findUnique({ where: { id }, select: { id: true } })) return
  const send = dispatch ?? (await import('@/lib/notifications/NotificationDispatcher')).dispatchNotification
  const result = await send({
    userIds: pool.members.map(member => member.userId),
    category: 'draft_alerts', productType: 'app', type: 'draft_starting_soon',
    title: 'Draft starting soon · ' + pool.name,
    body: 'Your tournament draft starts within the hour.',
    leagueId, actionHref: '/league/' + leagueId + '/draft', actionLabel: 'Open draft room',
    meta: { tournamentId, leagueId, startsAt }, severity: 'high',
    dedupePrefix: id, skipChannels: { sms: true },
  })
  if (result.failed > 0) return
  await prisma.tournamentAuditLog.upsert({
    where: { id }, update: {},
    create: { id, tournamentId, action: 'season_draft_reminder_dispatched', actorType: 'system', targetType: 'league', targetId: leagueId,
      data: { startsAt, delivered: result.delivered, suppressed: result.suppressed }, createdAt: now },
  })
}
