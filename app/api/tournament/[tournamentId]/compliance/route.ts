import { getServerSession } from 'next-auth'
import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { checkTournamentRosterCompliance } from '@/lib/tournament/rosterCompliance'

/**
 * Which managers are breaking the roster rules, across every league at once.
 *
 * ⚠ READ ONLY. It reports; it never edits a roster or penalises anybody. What to
 * do about a violation is the commissioner's call and, on an imported league,
 * their action to take on the host platform.
 */
export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ tournamentId: string }> },
) {
  const { tournamentId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Sign in required' }, { status: 401 })

  const report = await checkTournamentRosterCompliance(tournamentId, userId)
  if (!report) return NextResponse.json({ error: 'Tournament not found' }, { status: 404 })
  return NextResponse.json(report)
}
