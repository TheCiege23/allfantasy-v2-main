import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseSessionKey } from '@/lib/draft/session-key'
import { canAccessLeague } from '@/lib/draft/access'
import { BlockListUnavailableError, getBlockedSenderSetForRead } from '@/lib/moderation/BlockUserService'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sessionId = req.nextUrl.searchParams?.get('sessionId')?.trim()
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  let parsed: { mode: 'mock' | 'live'; id: string }
  try {
    parsed = parseSessionKey(sessionId)
  } catch {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }

  if (parsed.mode === 'live') {
    const ok = await canAccessLeague(parsed.id, userId)
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  /*
   * People this viewer blocked are not shown (App Store guideline 1.2), and a failed block-list read
   * is a 503, never an unfiltered transcript — the same rule as league chat's GET. System rows carry
   * no author and are never filtered.
   */
  let blocked: Set<string>
  try {
    blocked = await getBlockedSenderSetForRead(userId)
  } catch (err) {
    if (!(err instanceof BlockListUnavailableError)) throw err
    return NextResponse.json({ error: 'Messages are temporarily unavailable. Try again in a moment.' }, { status: 503 })
  }

  const limit = Math.min(100, Number(req.nextUrl.searchParams?.get('limit')) || 50)
  const rows = await prisma.draftRoomChatMessage.findMany({
    where: { sessionKey: sessionId },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })

  return NextResponse.json({
    messages: rows.filter((r) => !r.userId || !blocked.has(r.userId)).map((r) => ({
      id: r.id,
      /** The author, so the panel can offer Report and Block on somebody else's message. */
      authorUserId: r.userId ?? null,
      authorDisplayName: r.authorDisplayName,
      authorAvatar: r.authorAvatar,
      message: r.message,
      type: r.type,
      createdAt: r.createdAt.toISOString(),
    })),
  })
}

