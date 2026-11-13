import { NextResponse, type NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { prisma } from '@/lib/prisma'
import { loadCorrectionWeeks } from '@/lib/league-settings-hub/recordBookReads'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/stat-corrections
 * Per week of the current season: are its scores final, when was it rescored after stat
 * corrections, and — native leagues in the covered sports — which players changed, before → after
 * (league members). The per-player part is the stat-correction detector's stored review; see
 * lib/league-settings-hub/recordBookReads.ts.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: gate.status === 404 ? 'League not found' : 'Forbidden' }, { status: gate.status })

  try {
    const result = await loadCorrectionWeeks(prisma, leagueId)
    if (!result) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    return NextResponse.json({ leagueId, ...result })
  } catch (error) {
    console.error('[stat-corrections] GET failed', error)
    return NextResponse.json({ error: 'Could not load stat corrections' }, { status: 500 })
  }
}
