import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { markAllPlatformNotificationsRead } from '@/lib/platform/notification-service'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'

export async function PATCH(req: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, user.appUserId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const ok = await markAllPlatformNotificationsRead(user.appUserId, { leagueId })
  if (!ok) return NextResponse.json({ error: 'Unable to update notifications' }, { status: 500 })
  return NextResponse.json({ status: 'ok', leagueId })
}
