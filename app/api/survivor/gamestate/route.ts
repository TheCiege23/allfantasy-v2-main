import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { getOrCreateSurvivorGameState } from '@/lib/survivor/gameStateMachine'
import { loadImmunitySealed } from '@/lib/survivor/survivorSealedImmunityState'
import { resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const gs = await getOrCreateSurvivorGameState(leagueId)
  const challenge = gs.activeChallengeId
    ? await prisma.survivorChallenge.findUnique({ where: { id: gs.activeChallengeId } })
    : null

  // Sealed immunity: the individual winner stays hidden until the council's votes are in. The
  // winner and a non-playing host still see it.
  const sealed = gs.immunePlayerId && gs.immunePlayerId !== userId ? await loadImmunitySealed(leagueId, gs.currentWeek) : false
  const host = sealed ? (await resolveSurvivorAccessContext(leagueId, userId).catch(() => null))?.isNonParticipatingCommissionerHost === true : false

  return NextResponse.json({
    phase: gs.phase,
    currentWeek: gs.currentWeek,
    activePlayerCount: gs.activePlayerCount,
    immuneTribeId: gs.immuneTribeId,
    immunePlayerId: sealed && !host ? null : gs.immunePlayerId,
    immunitySealed: Boolean(sealed),
    activeCouncilId: gs.activeCouncilId,
    tribalDeadline: gs.tribalDeadline,
    activeChallengeId: gs.activeChallengeId,
    challengeLocksAt: challenge?.locksAt ?? challenge?.lockAt ?? null,
    weekScoringFinalAt: gs.weekScoringFinalAt,
    flags: {
      needsChallengeLock: gs.needsChallengeLock,
      needsTribalLock: gs.needsTribalLock,
      needsExileScore: gs.needsExileScore,
      needsPhaseAdvance: gs.needsPhaseAdvance,
    },

  })
}

