import { NextRequest, NextResponse } from 'next/server'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await params
  if (!leagueId) {
  // Membership gate. This route was reachable by anyone holding a league id.
  const gate = await requireLeagueApiAccess(leagueId)
  if (!gate.ok) return gate.response
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  }

  try {
    const [{ getDraftConfigForLeague }, { prisma }] = await Promise.all([
      import('@/lib/draft-defaults/DraftRoomConfigResolver'),
      import('@/lib/prisma'),
    ])

    const [config, league] = await Promise.all([
      getDraftConfigForLeague(leagueId),
      (prisma as any).league.findUnique({
        where: { id: leagueId },
        select: { leagueSize: true },
      }),
    ])

    if (!config) {
      return NextResponse.json({ error: 'League or draft config not found' }, { status: 404 })
    }

    return NextResponse.json({
      ...config,
      leagueSize: league?.leagueSize ?? 12,
    })
  } catch (e) {
    console.warn('[leagues/draft/config]', e)
    return NextResponse.json({ error: 'Failed to load draft config' }, { status: 500 })
  }
}
