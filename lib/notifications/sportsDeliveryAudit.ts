import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { NotificationDeliveryReceipt } from './deliveryReceipt'

/** Records policy skips as well as provider handoffs. Accepted is not device delivery. */
export async function recordSportsDelivery(input: { eventKey: string; type: string; sport: string; occurredAt?: string; detectedAt: string }, receipt: NotificationDeliveryReceipt) {
  const cacheKey = `sports-alert-receipt:${createHash('sha256').update(`${input.eventKey}:${receipt.userId}`).digest('hex')}`
  const completed = Date.parse(receipt.completedAt)
  const occurred = input.occurredAt ? Date.parse(input.occurredAt) : NaN
  const detected = Date.parse(input.detectedAt)
  const data = { ...input, ...receipt, detectionLagMs: Number.isFinite(occurred) ? Math.max(0, detected - occurred) : null,
    processingMs: Math.max(0, completed - detected) }
  const expiresAt = new Date(Date.now() + 7 * 86400_000)
  await prisma.sportsDataCache.upsert({ where: { cacheKey }, update: { data, expiresAt }, create: { cacheKey, data, expiresAt } })
  if (data.processingMs > 120_000 || (data.detectionLagMs ?? 0) > 300_000) console.warn('[sports-alerts] delayed event', { eventKey: input.eventKey, sport: input.sport, processingMs: data.processingMs, detectionLagMs: data.detectionLagMs })
}
