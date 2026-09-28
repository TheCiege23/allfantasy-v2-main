import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueAccess } from '@/lib/league-access'
import { getChatBadge, markChimmyProactiveSeen } from '@/lib/chat-core/chatBadge'
import { markLeagueChatRead } from '@/lib/chat-core/leagueChatRead'

export const dynamic = 'force-dynamic'

/**
 * The chat bubble's count, cheap enough to ask for between page loads (owner's call 2026-09-25, "fix
 * the chat bubble count issues"). The badge was computed only when a /core page rendered, so it moved
 * on navigation or a 2-minute refresh at best.
 *
 *   GET                                   → { total, mentions, dm, league, chimmy }
 *   POST { scope: 'league', leagueId }    → that league's chat is read now (must be a member)
 *   POST { scope: 'chimmy' }              → Chimmy's weekly checks are seen
 */

async function signedInUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

export async function GET() {
  const userId = await signedInUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const badge = await getChatBadge(userId)
  return NextResponse.json(badge, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request) {
  const userId = await signedInUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { scope?: unknown; leagueId?: unknown } | null

  if (body?.scope === 'league') {
    const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
    if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
    // Only a member can move their own marker for a league — and it reveals nothing either way.
    if (!(await resolveLeagueAccess(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await markLeagueChatRead(userId, leagueId)
    return NextResponse.json({ ok: true })
  }

  if (body?.scope === 'chimmy') {
    await markChimmyProactiveSeen(userId)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'scope must be league or chimmy' }, { status: 400 })
}
