import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCommissionerOnly } from '@/lib/league/permissions'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const contestId = req.nextUrl.searchParams?.get('contestId')?.trim()
  const sport = req.nextUrl.searchParams?.get('sport')?.trim()
  const status = req.nextUrl.searchParams?.get('status')?.trim()

  if (contestId) {
    const contest = await prisma.bestBallContest.findFirst({
      where: { id: contestId },
      include: { pods: { include: { entries: true } }, entries: true },
    })
    if (!contest) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ contest })
  }

  const where =
    sport || status
      ? {
          ...(sport ? { sport } : {}),
          ...(status ? { status } : {}),
        }
      : {}
  const list = await prisma.bestBallContest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  return NextResponse.json({ contests: list })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    leagueId?: string
    name?: string
    sport?: string
    variant?: string
    podSize?: number
    rosterSize?: number
    rounds?: number
    advancersPerPod?: number
    draftType?: string
    draftSpeed?: string
    entryType?: string
    maxEntriesPerUser?: number | null
    scoringPeriod?: string
    cumulativeScoring?: boolean
    resetBetweenRounds?: boolean
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const leagueId = body.leagueId?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  try {
    await requireCommissionerOnly(leagueId, userId)
  } catch (err) {
    if (err instanceof Response) return err
    throw err
  }

  const name = body.name?.trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true } })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (body.sport && body.sport !== league.sport) return NextResponse.json({ error: 'Contest sport must match the league' }, { status: 400 })

  const podSize = body.podSize ?? 12
  const rounds = body.rounds ?? 1
  const advancers = body.advancersPerPod ?? 1
  if (![podSize, rounds, advancers, body.rosterSize ?? 18].every(value => Number.isInteger(value) && value > 0) || advancers > podSize) return NextResponse.json({ error: 'Choose positive whole-number contest settings; advancers cannot exceed pod size' }, { status: 400 })
  let contest
  try {
    contest = await prisma.$transaction(async tx => {
      const created = await tx.bestBallContest.create({
        data: {
          name,
          sport: league.sport,
          variant: body.variant ?? 'tournament',
          podSize: body.podSize ?? 12,
          rosterSize: body.rosterSize ?? 18,
          rounds: body.rounds ?? 1,
          advancersPerPod: body.advancersPerPod ?? 1,
          draftType: body.draftType ?? 'snake',
          draftSpeed: body.draftSpeed ?? 'slow',
          entryType: body.entryType ?? 'single',
          maxEntriesPerUser: body.maxEntriesPerUser ?? null,
          scoringPeriod: body.scoringPeriod ?? 'weekly',
          cumulativeScoring: body.cumulativeScoring ?? true,
          resetBetweenRounds: body.resetBetweenRounds ?? false,
        },
      })
      const linked = await tx.league.updateMany({ where: { id: leagueId, bbContestId: null }, data: { bbContestId: created.id } })
      if (linked.count !== 1) throw new Error('League is already linked to a contest')
      return created
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Contest creation failed' }, { status: 409 })
  }

  return NextResponse.json({ contest })
}

