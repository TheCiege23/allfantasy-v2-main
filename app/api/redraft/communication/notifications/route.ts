import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { getPlatformNotifications } from '@/lib/platform/notification-service'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, user.appUserId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? '40') || 40))
  const notifications = await getPlatformNotifications(user.appUserId, limit, { leagueId })
  return NextResponse.json({
    status: 'ok',
    leagueId,
    notifications,
    unreadCount: notifications.filter((notification) => !notification.read).length,
  })
}
