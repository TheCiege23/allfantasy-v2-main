/**
 * POST: Regenerate IDP best-ball lineup snapshots for the league.
 * Commissioner only. Accepts periodKey (e.g. "2024-1") or runs for current week.
 * Actual optimization should be done by a job; this endpoint triggers or returns instructions.
 */

import { commissionerAccessResponse } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isIdpLeague, getIdpLeagueConfig } from '@/lib/idp'
import { prisma } from '@/lib/prisma'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await params
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const refused = await commissionerAccessResponse(leagueId, session.user.id, 'league')
  if (refused) return refused
  const isIdp = await isIdpLeague(leagueId)
  if (!isIdp) return NextResponse.json({ error: 'Not an IDP league' }, { status: 404 })

  const config = await getIdpLeagueConfig(leagueId)
  if (!config?.configId || !config.bestBallEnabled) {
    return NextResponse.json({ error: 'Best-ball not enabled for this league' }, { status: 400 })
  }

  const body = (await req.json().catch(() => ({}))) as { periodKey?: string }
  const periodKey = typeof body.periodKey === 'string' ? body.periodKey : null

  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true },
  })
  if (rosters.length === 0) {
    return NextResponse.json({ message: 'No rosters to snapshot', regenerated: 0 })
  }

  // Best-ball optimizer job should run per roster and call IdpBestBallSnapshotService.upsertIdpBestBallSnapshot.
  return NextResponse.json({
    message: 'Trigger best-ball snapshot regeneration via job. Pass leagueId and optional periodKey to the IDP best-ball optimizer job.',
    leagueId,
    periodKey: periodKey ?? null,
    rostersCount: rosters.length,
  })
}
