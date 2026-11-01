/**
 * [NEW] POST: HOH submits nominations (or commissioner on behalf). PROMPT 6 QA.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import { isCommissioner } from '@/lib/commissioner/permissions'
import { isBigBrotherLeague } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { getCurrentCycleForLeague } from '@/lib/big-brother/BigBrotherPhaseStateMachine'
import { setNominations } from '@/lib/big-brother/BigBrotherNominationEngine'
import { transitionPhase } from '@/lib/big-brother/BigBrotherPhaseStateMachine'
import { announceNominationCeremony } from '@/lib/big-brother/BigBrotherChatAnnouncements'
import { getRosterDisplayNamesForLeague } from '@/lib/big-brother/ai/getRosterDisplayNames'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const cycleId = body.cycleId as string
  const nominee1RosterId = body.nominee1RosterId as string
  const nominee2RosterId = body.nominee2RosterId as string
  if (!cycleId || !nominee1RosterId || !nominee2RosterId) {
    return NextResponse.json({ error: 'cycleId, nominee1RosterId, and nominee2RosterId required' }, { status: 400 })
  }

  const current = await getCurrentCycleForLeague(leagueId)
  if (!current || current.id !== cycleId) {
    return NextResponse.json({ error: 'Cycle not found or not current' }, { status: 400 })
  }

  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: cycleId },
    select: { phase: true, hohRosterId: true },
  })
  if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 })
  if ((cycle.phase as string) !== 'NOMINATION_OPEN') {
    return NextResponse.json({ error: 'Nominations are not open for this cycle' }, { status: 400 })
  }

  const ownedRoster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: userId },
    select: { id: true },
  })
  const coOwnerRosterId = ownedRoster ? null : await acceptedCoOwnerRosterId(leagueId, userId)
  const roster = ownedRoster ?? (coOwnerRosterId ? { id: coOwnerRosterId } : null)
  if (!roster) return NextResponse.json({ error: 'Not a league member' }, { status: 403 })

  const commissioner = await isCommissioner(leagueId, userId)
  if (cycle.hohRosterId !== roster.id && !commissioner) {
    return NextResponse.json({ error: 'Only the HOH (or commissioner) can nominate' }, { status: 403 })
  }

  const result = await setNominations(cycleId, nominee1RosterId, nominee2RosterId)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  await transitionPhase(cycleId, 'NOMINATION_LOCKED')

  const names = await getRosterDisplayNamesForLeague(leagueId, [nominee1RosterId, nominee2RosterId])
  await announceNominationCeremony({
    leagueId,
    week: current.week,
    nominee1RosterId,
    nominee2RosterId,
    name1: names[nominee1RosterId],
    name2: names[nominee2RosterId],
    systemUserId: commissioner ? userId : undefined,
  })

  return NextResponse.json({ ok: true, message: 'Nominations set' })
}
