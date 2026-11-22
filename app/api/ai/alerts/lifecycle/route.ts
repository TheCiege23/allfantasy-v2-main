import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { logAlertLifecycle } from '@/lib/chimmy-alerts'
import {
  snoozeAlert,
  clearSnooze,
  muteAlertType,
  muteAlertClass,
  resolveSnoozeDuration,
} from '@/lib/chimmy-alerts/ChimmyAlertPreferencesService'
import type { ChimmyAlertClass } from '@/lib/chimmy-alerts/types'
import { recordUnifiedMemoryInteraction } from '@/lib/ai-memory/unified-memory-system'

const BodySchema = z.object({
  alertId: z.string().min(8),
  dedupeKey: z.string().min(8),
  event: z.enum(['created', 'shown', 'clicked', 'dismissed', 'snoozed', 'acted_on', 'resolved', 'expired']),
  alertType: z.string().optional(),
  alertClass: z.string().optional(),
  /** Snooze duration shorthand: '15m' | '1h' | '4h' | '24h' | '7d' */
  snoozeDuration: z.string().optional(),
  /** When event='dismissed', also permanently mute this alert type. */
  muteType: z.boolean().optional(),
  /** When event='dismissed', also permanently mute the alert class. */
  muteClass: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(request: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const bodyRaw = await request.json().catch(() => ({}))
  const parsed = BodySchema.safeParse(bodyRaw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  const { alertId, dedupeKey, event, alertType, alertClass, snoozeDuration, muteType, muteClass, metadata } =
    parsed.data
  const userId = user.appUserId

  await logAlertLifecycle({
    userId,
    alertId,
    dedupeKey,
    event,
    metadata: {
      ...(metadata as Record<string, unknown> | undefined ?? {}),
      ...(alertType ? { alertType } : {}),
      ...(alertClass ? { alertClass } : {}),
    },
  })

  await recordUnifiedMemoryInteraction({
    userId,
    source: 'alerts',
    eventType: `lifecycle_${event}`,
    content: `${alertType ?? 'unknown_type'} (${alertClass ?? 'unknown_class'})`,
    metadata: {
      dedupeKey,
      muteType: Boolean(muteType),
      muteClass: Boolean(muteClass),
    },
  })

  // Snooze side effect
  if (event === 'snoozed') {
    const durationMs = resolveSnoozeDuration(snoozeDuration ?? '1h')
    await snoozeAlert(userId, dedupeKey, durationMs)
  }

  // Clear snooze when condition is resolved or user acted on it
  if (event === 'resolved' || event === 'acted_on') {
    await clearSnooze(userId, dedupeKey)
  }

  // Permanent mute side effects on dismiss
  if (event === 'dismissed') {
    if (muteType && alertType) {
      await muteAlertType(userId, alertType)
    }
    if (muteClass && alertClass) {
      await muteAlertClass(userId, alertClass as ChimmyAlertClass)
    }
  }

  return NextResponse.json({ ok: true, event })
}
