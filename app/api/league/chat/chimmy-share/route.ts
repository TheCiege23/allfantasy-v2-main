import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { shareChimmyAnswer } from '@/lib/league-chat/shareChimmyAnswer'

export const dynamic = 'force-dynamic'

/**
 * POST /api/league/chat/chimmy-share  { leagueId, messageId }
 *
 * Posts one of the signed-in user's own private @chimmy answers to their league chat, on their tap.
 * Every rule lives in lib/league-chat/shareChimmyAnswer.ts; this only authenticates and relays.
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const messageId = typeof body?.messageId === 'string' ? body.messageId.trim() : ''
  const result = await shareChimmyAnswer({ leagueId, userId, messageId })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({
    ok: true,
    alreadyShared: result.alreadyShared,
    sharedMessageId: result.sharedMessageId,
    message: result.message
      ? {
          id: result.message.id,
          parentMessageId: null,
          authorId: result.message.senderUserId ?? '',
          authorName: result.message.senderName ?? 'Chimmy',
          authorAvatarUrl: result.message.senderAvatarUrl ?? null,
          text: result.message.body,
          createdAt: result.message.createdAt,
          messageType: result.message.messageType ?? 'system',
          metadata: result.message.metadata ?? null,
        }
      : null,
  })
}
