/**
 * POST /api/leagues/[leagueId]/commissioner-rating/trigger
 * Triggers the commissioner rating prompt for a league (idempotent).
 * Called at season end or manually by system/commissioner.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { checkAndTriggerRatingIfOffseason } from '@/lib/commissioner/CommissionerRatingTrigger'
import { getLeagueRole } from '@/lib/league/permissions'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  // Posts to the league's chat, so only the league's commissioners may set it off.
  const role = await getLeagueRole(leagueId, session.user.id)
  if (role === null) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role !== 'commissioner' && role !== 'co_commissioner') return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  try {
    await checkAndTriggerRatingIfOffseason(leagueId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to trigger rating prompt' }, { status: 500 })
  }
}
