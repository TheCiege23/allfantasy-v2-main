import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertCommissioner } from '@/lib/commissioner/permissions'
import { getLeagueChatThreadId } from '@/lib/commissioner-settings/CommissionerAnnouncementService'
import {
  createSystemMessage,
  createPlatformThreadTypedMessage,
  setMessageHiddenByMod,
} from '@/lib/platform/chat-service'

/**
 * Commissioner chat: broadcast, pin, remove_message, into the league's linked chat thread.
 * The link is read through the validated accessor (lib/league/leagueChatThreadLink.ts): a stored
 * link to a DM or huddle is treated as no link, so this route can never post into, or hide
 * messages in, a conversation the league does not own.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { leagueId: string } }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await assertCommissioner(params.leagueId, userId)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const action = String(body?.action || '').toLowerCase()

  if (action === 'broadcast') {
    const message = body?.message || body?.text
    if (!message) return NextResponse.json({ error: 'message required for broadcast' }, { status: 400 })
    const threadId = await getLeagueChatThreadId(params.leagueId)
    if (!threadId) {
      return NextResponse.json({
        status: 'not_linked',
        action: 'broadcast',
        message: 'No league chat thread is linked here. Announcements go through /api/commissioner/broadcast, which posts into league chat.',
      }, { status: 400 })
    }
    const sent = await createSystemMessage(threadId, 'broadcast', `@everyone ${String(message).trim()}`)
    return NextResponse.json({
      status: sent ? 'sent' : 'failed',
      action: 'broadcast',
      stored: !!sent,
      messageId: sent?.id ?? null,
    })
  }

  if (action === 'pin') {
    const messageId = body?.messageId
    if (!messageId) return NextResponse.json({ error: 'messageId required for pin' }, { status: 400 })
    const threadId = await getLeagueChatThreadId(params.leagueId)
    if (!threadId) {
      return NextResponse.json({
        status: 'not_linked',
        action: 'pin',
        message: 'No league chat thread is linked here, so there is nothing to pin in.',
      }, { status: 400 })
    }
    const sent = await createPlatformThreadTypedMessage(userId, threadId, 'pin', { messageId })
    return NextResponse.json({
      status: sent ? 'acknowledged' : 'failed',
      action: 'pin',
      messageId,
    })
  }

  if (action === 'remove_message' || action === 'remove') {
    const messageId = body?.messageId
    if (!messageId) return NextResponse.json({ error: 'messageId required for remove_message' }, { status: 400 })
    const threadId = await getLeagueChatThreadId(params.leagueId)
    if (!threadId) {
      return NextResponse.json({
        status: 'not_linked',
        message: 'No league chat thread is linked here, so there is nothing to moderate.',
      }, { status: 400 })
    }
    const ok = await setMessageHiddenByMod(threadId, messageId, true)
    return NextResponse.json({
      status: ok ? 'removed' : 'failed',
      action: 'remove_message',
      messageId,
    })
  }

  return NextResponse.json({ error: 'Invalid action. Use: broadcast, pin, remove_message' }, { status: 400 })
}
