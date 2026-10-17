import { NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { markPlatformNotificationRead } from '@/lib/platform/notification-service'

export async function PATCH(_req: Request, props: { params: Promise<{ notificationId: string }> }) {
  const params = await props.params
  const user = await resolvePlatformUser()
  if (!user.appUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ok = await markPlatformNotificationRead(user.appUserId, params.notificationId)
  if (!ok) {
    return NextResponse.json({ error: 'Unable to update notification' }, { status: 500 })
  }

  return NextResponse.json({ status: 'ok' })
}
