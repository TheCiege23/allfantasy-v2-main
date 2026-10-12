import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { recordAnalyticsEvent } from '@/lib/analytics/recordAnalyticsEvent'
import { HIGHLIGHTS_PREFIX, parseHighlightMeta } from '@/lib/analytics/highlights'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { ANALYTICS_TOOL_PRODUCT } from '@/lib/analytics/eventNames'

export const dynamic = 'force-dynamic'

const ALLOWED_PREFIXES = [
  'product.create_league.',
  'engagement.',
  'product.',
]

function isAllowedEvent(event: string): boolean {
  if (event.length === 0 || event.length > 200) return false
  return ALLOWED_PREFIXES.some((p) => event.startsWith(p))
}

export async function POST(req: NextRequest) {
  let body: { event?: string; sessionId?: string; path?: string; meta?: Record<string, unknown> }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ ok: false, error: 'Invalid event' }, { status: 400 })
  const event = typeof body.event === 'string' ? body.event.trim() : ''
  if (!isAllowedEvent(event)) {
    return NextResponse.json({ ok: false, error: 'Event not allowed' }, { status: 400 })
  }

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id ?? null
  if (event.startsWith(HIGHLIGHTS_PREFIX)) {
    const headers = { 'Cache-Control': 'private, no-store' }
    if (!userId) return NextResponse.json({ ok: false }, { status: 401, headers })
    const meta = parseHighlightMeta(event, body.meta)
    if (!meta) return NextResponse.json({ ok: false, error: 'Invalid highlight event' }, { status: 400, headers })
    const limit = consumeRateLimit({ scope: 'analytics', action: 'highlights', sleeperUsername: userId, ip: getClientIp(req), includeIpInKey: true, maxRequests: 120, windowMs: 60_000 })
    if (!limit.success) return NextResponse.json({ ok: false }, { status: 429, headers: { ...headers, 'Retry-After': String(limit.retryAfterSec) } })
    await recordAnalyticsEvent({ event, toolKey: ANALYTICS_TOOL_PRODUCT, userId, path: '/core', meta })
    return NextResponse.json({ ok: true }, { headers })
  }
  const sessionId =
    typeof body.sessionId === 'string' && body.sessionId.length <= 80 ? body.sessionId : null
  const path = typeof body.path === 'string' && body.path.length <= 500 ? body.path : null
  const meta =
    body.meta && typeof body.meta === 'object' && !Array.isArray(body.meta)
      ? (body.meta as Record<string, unknown>)
      : null

  await recordAnalyticsEvent({
    event,
    toolKey: ANALYTICS_TOOL_PRODUCT,
    userId,
    sessionId,
    path,
    meta,
  })

  return NextResponse.json({ ok: true })
}
