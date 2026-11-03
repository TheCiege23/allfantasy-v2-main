import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import { isBigBrotherLeague } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { getCurrentCycleForLeague } from '@/lib/big-brother/BigBrotherPhaseStateMachine'
import { transitionPhase } from '@/lib/big-brother/BigBrotherPhaseStateMachine'
import { applyBigBrotherVeto } from '@/lib/big-brother/BigBrotherVetoEngine'

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
  const action = body.action as 'use' | 'pass' | undefined
  const savedRosterId = body.savedRosterId as string | undefined
  if (action !== 'use' && action !== 'pass') {
    return NextResponse.json({ error: 'action must be use or pass' }, { status: 400 })
  }

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
    select: { phase: true, vetoWinnerRosterId: true },
  })
  if (!cycle || cycle.phase !== 'VETO_DECISION_OPEN' || cycle.vetoWinnerRosterId !== roster.id) {
    return NextResponse.json({ error: 'Not the veto winner or veto not open' }, { status: 400 })
  }

  if (action === 'pass') {
    await transitionPhase(current.id, 'VOTING_OPEN')
    return NextResponse.json({ ok: true })
  }

  if (!savedRosterId) return NextResponse.json({ error: 'savedRosterId required for use' }, { status: 400 })
  const vu = await applyBigBrotherVeto(current.id, savedRosterId)
  if (!vu.ok) return NextResponse.json({ error: vu.error ?? 'Veto failed' }, { status: 400 })
  await transitionPhase(current.id, 'REPLACEMENT_NOMINATION_OPEN')
  return NextResponse.json({ ok: true })
}
