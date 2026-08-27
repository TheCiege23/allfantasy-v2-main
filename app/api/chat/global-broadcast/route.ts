import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireVerifiedUser } from '@/lib/auth-guard'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { getLeagueMemberUserIds } from '@/lib/league-chat/leagueMemberIds'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await requireVerifiedUser()
  if (!auth.ok) return auth.response
  const userId = auth.userId

  const body = await req.json().catch(() => ({}))
  const selectedLeagueIds = Array.isArray(body?.selectedLeagueIds)
    ? Array.from(new Set((body.selectedLeagueIds as string[]).map(String).filter(Boolean)))
    : []
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  const messageType = (body?.messageType as string) || 'text'

  if (selectedLeagueIds.length === 0) {
    return NextResponse.json({ error: 'No leagues selected' }, { status: 400 })
  }

  /*
   * ⚠ THIS IS NARROWER THAN THE PICKER THAT FEEDS IT, AND THE GAP WAS SILENT.
   * Ownership (`League.userId`) is only one of the ways this codebase calls
   * somebody a commissioner — `LeagueTeam.isCommissioner` / `isCoCommissioner`
   * and a redraft `COMMISSIONER` role both count elsewhere, and the composer's
   * league picker offers all of them. Selecting three leagues and owning one
   * therefore sent to one and reported success, so a commissioner believed a
   * draft reminder had reached three leagues when two never saw it.
   *
   * The permitted set is deliberately NOT widened here — who may address every
   * member of a league is a product decision, not a consistency cleanup. What
   * changes is that the skipped leagues are now named in the response instead of
   * disappearing.
   */
  const leagues = await prisma.league.findMany({
    where: { id: { in: selectedLeagueIds }, userId },
    select: { id: true, name: true },
  })
  const permittedIds = new Set(leagues.map((l) => l.id))
  const skippedLeagueIds = selectedLeagueIds.filter((id) => !permittedIds.has(id))

  if (leagues.length === 0) {
    return NextResponse.json(
      {
        error: 'No leagues you commission',
        skippedLeagueIds,
      },
      { status: 403 },
    )
  }

  const broadcastId = randomUUID()
  const sender = await prisma.appUser.findUnique({
    where: { id: userId },
    select: { displayName: true, username: true, email: true },
  })
  const commissionerName = sender?.displayName || sender?.username || sender?.email || 'Commissioner'

  const metaPayload: Record<string, unknown> = {
    globalBroadcast: true,
    messageType,
    event: body?.event ?? null,
    poll: body?.poll ?? null,
    gif: body?.gifUrl ?? null,
    image: body?.imageUrl ?? null,
  }

  let createdCount = 0
  for (const league of leagues) {
    const display =
      text ||
      (messageType === 'event' && body?.event?.title ? `📅 ${body.event.title}` : '') ||
      (messageType === 'poll' && body?.poll?.question ? `📊 ${body.poll.question}` : '') ||
      '📡 League announcement'

    const row = await createLeagueChatMessage(league.id, userId, display, {
      type: messageType === 'poll' ? 'poll' : messageType === 'event' ? 'text' : 'text',
      messageSubtype: 'global_broadcast',
      globalBroadcastId: broadcastId,
      metadata: metaPayload,
    })
    if (row) createdCount++

    const memberIds = await getLeagueMemberUserIds(league.id)
    const targets = memberIds.filter((id) => id !== userId)
    if (targets.length > 0) {
      await dispatchNotification({
        userIds: targets,
        category: 'league_announcements',
        productType: 'app',
        type: 'global_broadcast',
        title: '📡 League announcement',
        body: `${commissionerName} posted an announcement in ${league.name ?? 'your league'}.`,
        severity: 'low',
        actionHref: `/league/${encodeURIComponent(league.id)}`,
        actionLabel: 'View message',
        meta: { leagueId: league.id, globalBroadcastId: broadcastId },
      })
    }
  }

  return NextResponse.json({
    success: true,
    sentToLeagues: createdCount,
    /*
     * Named, not just counted. "Sent to 1 league" after picking three is a
     * number the sender has to notice and then cannot explain.
     */
    skippedLeagueIds,
    broadcastId,
  })
}
