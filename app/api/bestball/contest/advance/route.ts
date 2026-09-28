import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { advancePodWinners } from '@/lib/bestball/contestEngine'
import { requireCommissionerOnly } from '@/lib/league/permissions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { contestId?: string; roundNumber?: number; leagueId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const contestId = body.contestId?.trim()
  const leagueId = body.leagueId?.trim()
  const roundNumber = body.roundNumber ?? 1
  if (!contestId || !leagueId || !Number.isInteger(roundNumber) || roundNumber < 1) {
    return NextResponse.json({ error: 'contestId and leagueId required' }, { status: 400 })
  }

  try {
    await requireCommissionerOnly(leagueId, userId)
  } catch (err) {
    if (err instanceof Response) return err
    throw err
  }

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { bbContestId: true, bbTiebreaker: true } })
  if (league?.bbContestId !== contestId) return NextResponse.json({ error: 'Contest is not linked to this league' }, { status: 403 })
  const contest = await prisma.bestBallContest.findFirst({ where: { id: contestId } })
  if (!contest) return NextResponse.json({ error: 'Contest not found' }, { status: 404 })

  const tieRule = league.bbTiebreaker === 'max_week' || league.bbTiebreaker === 'points_for' ? league.bbTiebreaker : 'advance_all'
  try {
    await advancePodWinners(contestId, roundNumber, tieRule)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Advancement failed' }, { status: 409 })
  }
  return NextResponse.json({ ok: true })
}
