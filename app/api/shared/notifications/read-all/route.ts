import { NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { markAllPlatformNotificationsRead } from '@/lib/platform/notification-service'

export async function PATCH(req: Request) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const leagueId = url.searchParams.get('leagueId')?.trim() || null
  const ok = await markAllPlatformNotificationsRead(user.appUserId, { leagueId })
  if (!ok) {
    return NextResponse.json({ error: 'Unable to update notifications' }, { status: 500 })
  }

  return NextResponse.json({ status: 'ok' })
}
