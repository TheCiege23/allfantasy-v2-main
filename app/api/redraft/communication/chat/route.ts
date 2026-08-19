import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import {
  createLeagueChatMessage,
  getLeagueChatMessages,
} from '@/lib/league-chat/LeagueChatMessageService'
import { validateMessageBody } from '@/lib/league-chat/LeagueMessageComposer'

export const dynamic = 'force-dynamic'

function normalizeLeagueChatSource(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'league') return null
  return trimmed
}

export async function GET(req: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, user.appUserId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') ?? '60') || 60))
  const source = normalizeLeagueChatSource(
    req.nextUrl.searchParams.has('source') ? req.nextUrl.searchParams.get('source') : undefined,
  )
  const messages = await getLeagueChatMessages(leagueId, {
    limit,
    source,
    requestingUserId: user.appUserId,
  })
  return NextResponse.json({
    status: 'ok',
    leagueId,
    threadId: `league:${leagueId}`,
    messages,
  })
}
export async function POST(req: NextRequest) {
  const user = await resolvePlatformUser()
  if (!user.appUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, user.appUserId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const message = String(body?.body ?? body?.message ?? '').trim()
  const messageType = String(body?.messageType ?? 'text').trim() || 'text'
  const validation = validateMessageBody(message)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error ?? 'Message body required' }, { status: 400 })
  }

  const metadata =
    body?.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : undefined
  const source = normalizeLeagueChatSource(body?.source)
  const created = await createLeagueChatMessage(leagueId, user.appUserId, message, {
    type: messageType,
    source,
    metadata: {
      ...(metadata ?? {}),
      g42Communication: true,
    },
  })
  if (!created) return NextResponse.json({ error: 'Unable to post message' }, { status: 500 })

  return NextResponse.json({
    status: 'ok',
    leagueId,
    threadId: `league:${leagueId}`,
    message: created,
  })
}
