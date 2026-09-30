import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { createPlatformThreadTypedMessage } from '@/lib/platform/chat-service'

export async function POST(req: NextRequest, props: { params: Promise<{ threadId: string }> }) {
  const params = await props.params
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const payload = {
    mediaUrl: String(body?.mediaUrl || ''),
    mediaType: String(body?.mediaType || 'image'),
    caption: String(body?.caption || ''),
  }

  if (!payload.mediaUrl) return NextResponse.json({ error: 'mediaUrl is required' }, { status: 400 })

  const created = await createPlatformThreadTypedMessage(user.appUserId, decodeURIComponent(params.threadId), 'media', payload)
  if (!created) return NextResponse.json({ error: 'Unable to post media' }, { status: 400 })

  return NextResponse.json({ status: 'ok', message: created })
}
