import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { getPlatformThreadById, updateThreadTitle } from '@/lib/platform/chat-service'

export async function GET(_req: Request, props: { params: Promise<{ threadId: string }> }) {
  const params = await props.params
  const user = await resolvePlatformUser()
  if (!user.appUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const thread = await getPlatformThreadById(user.appUserId, decodeURIComponent(params.threadId))
  if (!thread) {
    return NextResponse.json({ error: 'Thread not found' }, { status: 404 })
  }

  return NextResponse.json({ status: 'ok', thread })
}

/** PATCH: rename thread (title). Body: { title: string } */
export async function PATCH(req: NextRequest, props: { params: Promise<{ threadId: string }> }) {
  const params = await props.params
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const threadId = decodeURIComponent(params.threadId)
  const body = await req.json().catch(() => ({}))
  const title = String(body?.title ?? '').trim()

  const ok = await updateThreadTitle(user.appUserId, threadId, title)
  if (!ok) return NextResponse.json({ error: 'Unable to update' }, { status: 400 })
  return NextResponse.json({ status: 'ok' })
}
