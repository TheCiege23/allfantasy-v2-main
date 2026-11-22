import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import { isBigBrotherLeague } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { getCurrentCycleForLeague } from '@/lib/big-brother/BigBrotherPhaseStateMachine'
import { transitionPhase } from '@/lib/big-brother/BigBrotherPhaseStateMachine'
import { setReplacementNominee } from '@/lib/big-brother/BigBrotherNominationEngine'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const replacementRosterId = body.replacementRosterId as string | undefined
  if (!replacementRosterId) return NextResponse.json({ error: 'replacementRosterId required' }, { status: 400 })

  const current = await getCurrentCycleForLeague(leagueId)
  if (!current) return NextResponse.json({ error: 'No cycle' }, { status: 400 })

  const ownedRoster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  const coOwnerRosterId = ownedRoster ? null : await acceptedCoOwnerRosterId(leagueId, userId)
  const roster = ownedRoster ?? (coOwnerRosterId ? { id: coOwnerRosterId } : null)
  if (!roster) return NextResponse.json({ error: 'Not a league member' }, { status: 403 })

  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: current.id },
    select: { phase: true, hohRosterId: true },
  })
  if (!cycle || cycle.phase !== 'REPLACEMENT_NOMINATION_OPEN' || cycle.hohRosterId !== roster.id) {
    return NextResponse.json({ error: 'Only HOH can set replacement now' }, { status: 400 })
  }

  const res = await setReplacementNominee(current.id, replacementRosterId)
  if (!res.ok) return NextResponse.json({ error: res.error ?? 'Failed' }, { status: 400 })
  await transitionPhase(current.id, 'VOTING_OPEN')
  return NextResponse.json({ ok: true })
}
