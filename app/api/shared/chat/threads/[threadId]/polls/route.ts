import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { createPlatformThreadTypedMessage } from '@/lib/platform/chat-service'
import { getCreatePollPayload } from '@/lib/social-chat'

export async function POST(req: NextRequest, props: { params: Promise<{ threadId: string }> }) {
  const params = await props.params
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const normalized = getCreatePollPayload(
    String(body?.question || ''),
    Array.isArray(body?.options) ? body.options.map((v: unknown) => String(v)) : [],
  )
  const question = normalized.question
  const options = normalized.options

  if (!question || options.length < 2) {
    return NextResponse.json({ error: 'question and at least two options are required' }, { status: 400 })
  }

  const created = await createPlatformThreadTypedMessage(
    user.appUserId,
    decodeURIComponent(params.threadId),
    'poll',
    { question, options, expiresAt: body?.expiresAt || null },
  )

  if (!created) return NextResponse.json({ error: 'Unable to create poll' }, { status: 400 })
  return NextResponse.json({ status: 'ok', message: created })
}
