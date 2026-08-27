import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { createPlatformThreadTypedMessage } from '@/lib/platform/chat-service'
import { resolveLeagueAccess } from '@/lib/league-access'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { getLeagueIdFromVirtualRoom, isLeagueVirtualRoom } from '@/lib/chat-core'
import { prisma } from '@/lib/prisma'

const PIN_SNIPPET_MAX = 120

export async function POST(req: NextRequest, { params }: { params: { threadId: string } }) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)
  const body = await req.json().catch(() => ({}))
  const messageId = String(body?.messageId || '').trim()
  if (!messageId) return NextResponse.json({ error: 'messageId is required' }, { status: 400 })
  let snippet: string | undefined

  if (isLeagueVirtualRoom(threadId)) {
    const leagueId = getLeagueIdFromVirtualRoom(threadId)
    if (!leagueId) return NextResponse.json({ error: 'Invalid league room' }, { status: 400 })

    const bracketMember = await (prisma as any).bracketLeagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.appUserId } },
      select: { id: true },
    })

    if (bracketMember) {
      const bracketRef = await (prisma as any).bracketLeagueMessage.findFirst({
        where: { id: messageId, leagueId },
        select: { message: true },
      })
      if (!bracketRef) {
        return NextResponse.json({ error: 'Message not found in this league' }, { status: 404 })
      }
      const raw = typeof bracketRef.message === 'string' ? bracketRef.message : String(bracketRef.message ?? '')
      snippet = raw.slice(0, PIN_SNIPPET_MAX).trim()
      if (raw.length > PIN_SNIPPET_MAX) snippet += '…'

      const created = await (prisma as any).bracketLeagueMessage.create({
        data: {
          leagueId,
          userId: user.appUserId,
          message: JSON.stringify({ messageId, snippet: snippet || 'Pinned message' }),
          type: 'pin',
        },
      })
      return NextResponse.json({ status: 'ok', message: created })
    }

    /*
     * ⚠ SAME WRONG PREDICATE THE REACTION ROUTE HAD. `canAccessLeagueDraft`
     * needs a Roster row or a CLAIMED LeagueTeam; production has 1,078 league
     * teams and 94 claimed. `/api/league/chat` admits anyone
     * `resolveLeagueAccess` recognises, so most members could read a thread and
     * be refused the moment they pinned in it.
     */
    const canAccessMainLeague = (await resolveLeagueAccess(leagueId, user.appUserId)) != null
    if (!canAccessMainLeague) {
      return NextResponse.json({ error: 'Not a member' }, { status: 403 })
    }

    const mainRef = await (prisma as any).leagueChatMessage.findFirst({
      where: { id: messageId, leagueId },
      select: { message: true },
    })
    if (!mainRef) {
      return NextResponse.json({ error: 'Message not found in this league' }, { status: 404 })
    }
    const raw = typeof mainRef.message === 'string' ? mainRef.message : String(mainRef.message ?? '')
    snippet = raw.slice(0, PIN_SNIPPET_MAX).trim()
    if (raw.length > PIN_SNIPPET_MAX) snippet += '…'

    const created = await createLeagueChatMessage(leagueId, user.appUserId, JSON.stringify({ messageId, snippet: snippet || 'Pinned message' }), {
      type: 'pin',
    })
    if (!created) return NextResponse.json({ error: 'Unable to pin message' }, { status: 400 })
    return NextResponse.json({ status: 'ok', message: created })
  }

  const ref = await prisma.platformChatMessage.findFirst({
    where: { id: messageId, threadId },
    select: { body: true, messageType: true },
  })
  if (ref?.body) {
    const raw = typeof ref.body === 'string' ? ref.body : JSON.stringify(ref.body)
    snippet = raw.slice(0, PIN_SNIPPET_MAX).trim()
    if (raw.length > PIN_SNIPPET_MAX) snippet += '…'
  }

  const created = await createPlatformThreadTypedMessage(
    user.appUserId,
    threadId,
    'pin',
    { messageId, snippet: snippet || 'Pinned message' }
  )
  if (!created) return NextResponse.json({ error: 'Unable to pin message' }, { status: 400 })

  return NextResponse.json({ status: 'ok', message: created })
}
