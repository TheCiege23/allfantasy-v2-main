import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { prisma } from '@/lib/prisma'
import { formatLeagueEventRow } from '@/lib/league-feed/leagueFeedFormatter'
import { getLeagueChatMessages } from '@/lib/league-chat/LeagueChatMessageService'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, user.appUserId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const limit = Math.min(80, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? '40') || 40))
  const [feedRows, chatMessages] = await Promise.all([
    prisma.leagueEvent.findMany({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        eventType: true,
        title: true,
        description: true,
        payload: true,
        createdAt: true,
      },
    }),
    getLeagueChatMessages(leagueId, {
      limit: 12,
      requestingUserId: user.appUserId,
      messageTypeIn: [
        'commissioner_notice',
        'draft_notice',
        'draft_summary',
        'lineup_notice',
        'waiver_notice',
        'trade_notice',
        'trade_accepted',
        'scoring_notice',
        'matchup_notice',
        'playoff_notice',
        'champion_announcement',
        'system',
      ],
    }),
  ])

  return NextResponse.json({
    status: 'ok',
    leagueId,
    items: feedRows.map((row) => formatLeagueEventRow(row)),
    systemMessages: chatMessages,
  })
}
