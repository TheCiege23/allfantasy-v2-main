import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { createPlatformThreadTypedMessage } from '@/lib/platform/chat-service'
import { sanitizeClientImageUrl } from '@/lib/chat-core/clientMessageInput'
import { chatRateLimitResponse } from '@/lib/chat-core/chatRateLimits'

const MEDIA_TYPES = new Set(['image', 'video', 'voice', 'file'])

/*
 * 🛑 THIS STORED ANY STRING AS `mediaUrl`, with an unbounded caption and no send limit, while the
 * messages route reduces every client URL to our own upload link. No shipped web client calls it
 * (audit 2026-10-10), but a route that exists is reachable, so it now keeps the same contract:
 * our own upload link only (re-checked for membership on every read), a bounded caption, and the
 * shared send ceiling.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ threadId: string }> }) {
  const params = await props.params
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const limited = chatRateLimitResponse(user.appUserId, 'message_send')
  if (limited) return limited

  const body = await req.json().catch(() => ({}))
  const rawUrl = typeof body?.mediaUrl === 'string' ? body.mediaUrl.trim() : ''
  const mediaUrl = rawUrl.startsWith('/') ? sanitizeClientImageUrl(rawUrl) : null
  const mediaType = MEDIA_TYPES.has(String(body?.mediaType)) ? String(body.mediaType) : 'image'
  const caption = String(body?.caption || '').trim()

  if (!mediaUrl) return NextResponse.json({ error: 'mediaUrl must be an AllFantasy upload' }, { status: 400 })
  if (caption.length > 1000) return NextResponse.json({ error: 'Caption too long' }, { status: 400 })

  const created = await createPlatformThreadTypedMessage(user.appUserId, decodeURIComponent(params.threadId), 'media', {
    mediaUrl,
    mediaType,
    caption,
  })
  if (!created) return NextResponse.json({ error: 'Unable to post media' }, { status: 400 })

  return NextResponse.json({ status: 'ok', message: created })
}
