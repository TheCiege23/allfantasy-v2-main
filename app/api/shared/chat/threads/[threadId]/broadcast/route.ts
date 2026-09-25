import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { createPlatformThreadTypedMessage } from '@/lib/platform/chat-service'
import { getLeagueIdFromVirtualRoom, isLeagueVirtualRoom } from '@/lib/chat-core'
import { getLeagueRole } from '@/lib/league/permissions'
import { prisma } from '@/lib/prisma'

/*
 * 🛑 ANY THREAD MEMBER COULD BROADCAST (found 2026-09-25). This route took the sender's word for
 * everything: sign in, name a thread you are in, and your text went out as a `broadcast` — the
 * commissioner-announcement style — to the whole thread.
 *
 * A broadcast now needs the sender to be the head commissioner or a co-commissioner
 * (`getLeagueRole`, the same two roles lib/commissioner/broadcastAccess.ts sends as) of a league the
 * thread BELONGS to. That league is derived here, server-side, and never from the body: the only
 * caller (components/chat/CommissionerBroadcastForm.tsx) also sends `leagueIds`, and a client can
 * put any league it runs there. The trusted links are:
 *
 *   - `league:<id>` virtual rooms — the id IS the league;
 *   - a platform thread named by `League.settings.leagueChatThreadId`, the link every commissioner
 *     surface already uses (CommissionerTab, CommissionerControlsPanel, the commissioner chat route).
 *
 * A thread with neither (a DM, an unlinked huddle) has no league, so there is nobody who is its
 * commissioner, and the broadcast is refused rather than guessed at.
 */
const BROADCAST_ROLES = new Set(['commissioner', 'co_commissioner'])

async function leaguesOwningThread(threadId: string): Promise<string[]> {
  if (isLeagueVirtualRoom(threadId)) {
    const leagueId = getLeagueIdFromVirtualRoom(threadId)
    return leagueId ? [leagueId] : []
  }
  const linked = await prisma.league.findMany({
    where: { settings: { path: ['leagueChatThreadId'], equals: threadId } },
    select: { id: true },
  })
  return linked.map((league) => league.id)
}

export async function POST(req: NextRequest, { params }: { params: { threadId: string } }) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = user.appUserId

  const body = await req.json().catch(() => ({}))
  const announcement = String(body?.announcement || body?.body || '').trim()
  if (!announcement) return NextResponse.json({ error: 'announcement is required' }, { status: 400 })

  const threadId = decodeURIComponent(params.threadId)
  const leagueIds = await leaguesOwningThread(threadId)
  const roles = await Promise.all(leagueIds.map((leagueId) => getLeagueRole(leagueId, userId)))
  if (!roles.some((role) => BROADCAST_ROLES.has(role ?? ''))) {
    return NextResponse.json(
      { error: "Only this league's commissioner can send an announcement here." },
      { status: 403 },
    )
  }

  const created = await createPlatformThreadTypedMessage(userId, threadId, 'broadcast', { announcement })

  if (!created) return NextResponse.json({ error: 'Unable to post broadcast' }, { status: 400 })
  return NextResponse.json({ status: 'ok', message: created })
}
