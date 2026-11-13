import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { recordChimmyPersonalizationEvent } from '@/lib/chimmy-personalization'

export const dynamic = 'force-dynamic'

const EventSchema = z.object({
  type: z.enum([
    'recommendation_accepted',
    'recommendation_rejected',
    'recommendation_saved',
    'recommendation_reopened',
    'recommendation_dismissed',
    'alert_clicked',
    'alert_dismissed',
    'story_opened',
    'story_hidden',
    'surface_opened',
    'action_executed',
    'memory_item_corrected',
    'memory_item_ignored',
  ]),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export async function POST(req: Request) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const parsed = EventSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  await recordChimmyPersonalizationEvent(user.appUserId, parsed.data)
  return NextResponse.json({ ok: true })
}
