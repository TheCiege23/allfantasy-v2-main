import { createHash, randomUUID } from 'node:crypto'
import { gameAlertDeadline, isLiveGameAlert } from './gameAlertFreshness'
import { prisma } from '@/lib/prisma'

export type TransportMessage = {
  userId: string; leagueId?: string | null; channel: 'email' | 'push'; eventType: string
  title: string; body: string; eventKey?: string; metadata: Record<string, unknown>
}

/** Persist before handoff; failed sends and interrupted requests remain recoverable by the relay. */
export async function deliverDurably(message: TransportMessage, send: () => Promise<void | 'unavailable'>): Promise<'sent' | 'queued' | 'skipped' | 'existing'> {
  const id = createHash('sha256').update(`${message.eventKey ?? randomUUID()}:${message.userId}:${message.channel}`).digest('hex')
  const { eventKey: _, ...data } = message
  const stored = await prisma.notificationOutbox.upsert({ where: { id }, update: {}, create: { id, ...data, metadata: data.metadata as never }, select: { createdAt: true, metadata: true } })
  const claim = await prisma.notificationOutbox.updateMany({ where: { id, status: 'pending' }, data: { status: 'sending', updatedAt: new Date() } })
  if (!claim.count) return 'existing'
  const storedMetadata = stored.metadata && typeof stored.metadata === 'object' ? stored.metadata as Record<string, unknown> : {}
  const deadline = gameAlertDeadline(message.eventType, stored.createdAt, storedMetadata.expiresAt)
  if ((message.channel === 'email' && isLiveGameAlert(message.eventType)) || (deadline !== undefined && deadline <= Date.now())) {
    await prisma.notificationOutbox.update({ where: { id }, data: { status: 'skipped', lastError: 'Live game email disabled or notification expired before delivery', attemptCount: { increment: 1 } } })
    return 'skipped'
  }
  try {
    const outcome = await send()
    if (outcome === 'unavailable') {
      await prisma.notificationOutbox.update({ where: { id }, data: { status: 'skipped', lastError: 'No subscribed devices', attemptCount: { increment: 1 } } })
      return 'skipped'
    }
    await prisma.notificationOutbox.update({ where: { id }, data: { status: 'sent', sentAt: new Date(), attemptCount: { increment: 1 }, lastError: null } })
    return 'sent'
  } catch (e) {
    await prisma.notificationOutbox.update({ where: { id }, data: { status: 'pending', sendAfter: new Date(Date.now() + 5000), attemptCount: { increment: 1 }, lastError: String(e).slice(0, 500) } })
    console.warn('[notifications] transport queued for retry', { id, channel: message.channel })
    return 'queued'
  }
}
