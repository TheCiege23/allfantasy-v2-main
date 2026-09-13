import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { createActionEvent, listActionEvents } from '@/lib/chimmy-actions/server-store'
import type { AIActionEvent, AIActionType } from '@/lib/chimmy-actions'

const BodySchema = z.object({
  id: z.string().min(1),
  actionType: z.string().min(1),
  surface: z.string().min(1),
  userId: z.string().min(1),
  leagueId: z.string().optional().nullable(),
  teamId: z.string().optional().nullable(),
  sport: z.string().optional().nullable(),
  event: z.enum(['shown', 'clicked', 'confirmed', 'staged', 'completed', 'dismissed', 'saved', 'failed']),
  timestamp: z.number().int(),
  durationMs: z.number().int().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const sessionUserId = session?.user?.id
  if (!sessionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', details: parsed.error.flatten() }, { status: 400 })
  }

  if (parsed.data.userId !== sessionUserId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const event: AIActionEvent = {
      ...parsed.data,
      actionType: parsed.data.actionType as AIActionType,
      durationMs: parsed.data.durationMs,
      metadata: parsed.data.metadata,
    }
    await createActionEvent(event)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to persist action event', details: String(error) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const sessionUserId = session?.user?.id
  if (!sessionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limitRaw = req.nextUrl.searchParams.get('limit')
  const limit = Math.max(1, Math.min(Number(limitRaw ?? '1000') || 1000, 5000))

  const rows = await listActionEvents(sessionUserId, limit)
  return NextResponse.json({ ok: true, rows })
}
