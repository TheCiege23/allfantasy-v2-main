/**
 * GET: what "Draft like me" knows about the signed-in manager in this league's draft — whether it has
 * enough of their own picks to draft like them, and where it learned that (2026-11-21). The draft room
 * shows the summary under the auto-pick switch, so a manager can see why Chimmy drafts the way it does
 * before it does. Reads Postgres only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { draftAsMeStatus } from '@/lib/draft-room/draftAsMeAutopick'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  if (!(await canAccessLeagueDraft(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rosterId = await getCurrentUserRosterIdForLeague(leagueId, userId).catch(() => null)
  if (!rosterId) return NextResponse.json({ error: 'No team in this league' }, { status: 404 })

  try {
    return NextResponse.json({ style: await draftAsMeStatus(leagueId, rosterId) })
  } catch {
    return NextResponse.json({ error: 'Could not read your past drafts' }, { status: 500 })
  }
}
