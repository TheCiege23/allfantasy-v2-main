import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getWalkthroughSeen, isWalkthroughFormat, markWalkthroughSeenForUser } from '@/lib/league/whats-next/walkthroughSeenStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The signed-in user's format-walkthrough "seen" state (lib/league/whats-next/walkthroughSeenStore.ts).
 *
 * GET  → { seen: { big_brother: "<iso>", … } }, or 503 when the read failed — the client then keeps its
 *        browser flag rather than treating "unknown" as "never seen".
 * POST { format } → marks that format seen. Only formats that have a walkthrough are accepted.
 *
 * Reads and writes only the caller's own row; nothing here takes a user id from the request.
 */
async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never).catch(() => null)) as { user?: { id?: string | null } } | null
  const id = session?.user?.id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

export async function GET() {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const seen = await getWalkthroughSeen(userId)
  if (seen == null) return NextResponse.json({ error: 'Unavailable' }, { status: 503 })
  return NextResponse.json({ seen }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { format?: unknown } | null
  if (!isWalkthroughFormat(body?.format)) return NextResponse.json({ error: 'Unknown format' }, { status: 400 })
  try {
    await markWalkthroughSeenForUser(userId, body.format)
  } catch {
    return NextResponse.json({ error: 'Could not save' }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}
