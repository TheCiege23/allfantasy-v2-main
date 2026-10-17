import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseSessionKey } from '@/lib/draft/session-key'
import { startDraftSession } from '@/lib/live-draft-engine/DraftSessionService'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  let parsed: ReturnType<typeof parseSessionKey>
  try {
    parsed = parseSessionKey(sessionId)
  } catch {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
  }
  if (parsed.mode === 'mock') {
    const room = await prisma.mockDraftRoom.findUnique({ where: { id: parsed.id } })
    if (!room || room.createdById !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    await prisma.mockDraftRoom.update({ where: { id: parsed.id }, data: { status: 'active' } })
    const ends = new Date(Date.now() + 90 * 1000)
    await prisma.draftRoomStateRow.update({
      where: { id: sessionId },
      data: { status: 'active', timerEndsAt: ends, updatedAt: new Date() },
    })
    return NextResponse.json({ success: true })
  }

  const league = await prisma.league.findFirst({ where: { id: parsed.id, userId }, select: { id: true } })
  if (!league) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const started = await startDraftSession(parsed.id)
  if (!started.ok) {
    if (started.reason === 'ROSTER_CONFIGURATION_INCOMPLETE') {
      return NextResponse.json({ error: 'Roster configuration incomplete', code: started.reason }, { status: 409 })
    }
    if (started.reason === 'SURVIVOR_CAST_INCOMPLETE') {
      return NextResponse.json({ code: started.reason, error: started.error }, { status: 409 })
    }
    return NextResponse.json({ error: 'Draft session is not ready' }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
