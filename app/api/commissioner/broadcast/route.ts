/**
 * POST: Commissioner @everyone broadcast to selected league chats.
 * Body: { leagueIds: string[], message: string }.
 * Permission, per league: head commissioner or co-commissioner (`canBroadcast`, the same rule
 * `GET /api/commissioner/leagues` lists by).
 * Also sends in-app + email/SMS notification to all league members (commissioner_alerts).
 *
 * ⚠ RATE-LIMITED PER USER. One call can fan out email and text to every member of several leagues,
 * and more than one person per league may now send. Five sends in ten minutes is well past any real
 * announcement cadence; a refused send is 429 and reaches nobody.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canBroadcast } from '@/lib/commissioner/broadcastAccess'
import { rateLimit } from '@/lib/rate-limit'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { getLeagueChatThreadId } from '@/lib/commissioner-settings/CommissionerAnnouncementService'
import { createSystemMessage } from '@/lib/platform/chat-service'
import { getLeagueMemberAppUserIds } from '@/lib/draft-notifications/DraftNotificationService'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { isLeaguePrefEnabled, parseLeagueNotificationPrefs } from '@/lib/league/league-notification-prefs'

export const dynamic = 'force-dynamic'

// Not exported: a route module may only export handlers and route config.
const BROADCASTS_PER_WINDOW = 5
const BROADCAST_WINDOW_MS = 10 * 60 * 1000

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const leagueIds = Array.isArray(body.leagueIds) ? body.leagueIds.map((id: unknown) => String(id)).filter(Boolean) : []
  const message = String(body?.message ?? body?.text ?? '').trim()
  if (leagueIds.length === 0) return NextResponse.json({ error: 'leagueIds required' }, { status: 400 })
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })
  if (message.length > 500) return NextResponse.json({ error: 'Message too long' }, { status: 400 })

  // Counted after validation, so a malformed request does not use up a send.
  const limit = rateLimit(`commissioner-broadcast:${userId}`, BROADCASTS_PER_WINDOW, BROADCAST_WINDOW_MS)
  if (!limit.success) {
    return NextResponse.json(
      { error: 'Too many announcements in a short time. Try again in a few minutes.' },
      { status: 429 },
    )
  }

  const results: { leagueId: string; sent: boolean; error?: string }[] = []
  const text = `@everyone ${message}`
  for (const leagueId of leagueIds) {
    if (!(await canBroadcast(leagueId, userId).catch(() => false))) {
      results.push({ leagueId, sent: false, error: 'Forbidden' })
      continue
    }
    const threadId = await getLeagueChatThreadId(leagueId)
    if (threadId && !threadId.startsWith('league:')) {
      const sent = await createSystemMessage(threadId, 'broadcast', text)
      results.push({ leagueId, sent: !!sent })
    } else {
      const created = await createLeagueChatMessage(leagueId, userId, text, { type: 'broadcast' })
      results.push({ leagueId, sent: !!created })
    }
    const memberIds = await getLeagueMemberAppUserIds(leagueId)
    const leagueRow = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { settings: true },
    })
    const prefs = parseLeagueNotificationPrefs(leagueRow?.settings)
    if (memberIds.length > 0 && isLeaguePrefEnabled(prefs, 'commissionerBroadcasts')) {
      dispatchNotification({
        userIds: memberIds,
        category: 'commissioner_alerts',
        productType: 'app',
        type: 'commissioner_broadcast',
        title: 'Commissioner announcement',
        body: message,
        actionHref: `/league/${leagueId}`,
        actionLabel: 'Open league',
        meta: { leagueId },
        severity: 'medium',
      }).catch((e) => console.error('[commissioner broadcast] notify', e))
    }
  }
  return NextResponse.json({ ok: true, results })
}
