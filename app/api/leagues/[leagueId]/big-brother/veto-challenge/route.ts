/**
 * GET  – returns current veto challenge state (participants, challenge theme hints, mode).
 * POST – commissioner resolves the veto challenge (seeded random or manual winner pick).
 *        Transitions phase from VETO_CHALLENGE_OPEN → VETO_DECISION_OPEN and sets vetoWinnerRosterId.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isBigBrotherLeague, getBigBrotherConfig } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { getCurrentCycleForLeague, transitionPhase } from '@/lib/big-brother/BigBrotherPhaseStateMachine'
import { setVetoWinner } from '@/lib/big-brother/BigBrotherVetoEngine'
import { runAutomation } from '@/lib/big-brother/BigBrotherAutomationService'
import { getRosterDisplayNamesForLeague } from '@/lib/big-brother/ai/getRosterDisplayNames'
import { getVetoChallengeThemeHints } from '@/lib/big-brother/sport-adapter'
import { appendBigBrotherAudit } from '@/lib/big-brother/BigBrotherAuditLog'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  const [config, current] = await Promise.all([
    getBigBrotherConfig(leagueId),
    getCurrentCycleForLeague(leagueId),
  ])
  if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 500 })
  if (!current) return NextResponse.json({ error: 'No active cycle' }, { status: 404 })

  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: current.id },
    select: {
      phase: true,
      week: true,
      hohRosterId: true,
      vetoParticipantRosterIds: true,
      vetoWinnerRosterId: true,
    },
  })
  if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 })

  const participants = (cycle.vetoParticipantRosterIds as string[] | null) ?? []
  const names = await getRosterDisplayNamesForLeague(leagueId, participants)
  const themeHints = getVetoChallengeThemeHints(config.sport)

  return NextResponse.json({
    phase: cycle.phase,
    week: cycle.week,
    participants,
    rosterDisplayNames: names,
    challengeMode: config.challengeMode,
    themeHints,
    vetoWinnerRosterId: cycle.vetoWinnerRosterId ?? null,
  })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  // Commissioner-only
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } })
  if (!league || league.userId !== userId) {
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  }

  const config = await getBigBrotherConfig(leagueId)
  if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 500 })

  const current = await getCurrentCycleForLeague(leagueId)
  if (!current) return NextResponse.json({ error: 'No active cycle' }, { status: 404 })

  if (current.phase !== 'VETO_CHALLENGE_OPEN') {
    return NextResponse.json(
      { error: `Cannot resolve veto challenge — phase is ${current.phase}, expected VETO_CHALLENGE_OPEN` },
      { status: 400 },
    )
  }

  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: current.id },
    select: { vetoParticipantRosterIds: true },
  })
  const participants = (cycle?.vetoParticipantRosterIds as string[] | null) ?? []
  if (participants.length === 0) {
    return NextResponse.json({ error: 'No veto participants found' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  if (config.weekProgressionPaused) return NextResponse.json({ error: 'Week progression is paused' }, { status: 409 })
  const manualWinnerId = typeof body.winnerRosterId === 'string' ? body.winnerRosterId : null
  if (!manualWinnerId) {
    const result = await runAutomation({ leagueId, action: 'auto_veto', systemUserId: userId })
    if (!result.ok || result.actionTaken?.startsWith('skipped_')) {
      return NextResponse.json({ error: result.error ?? (result.actionTaken === 'skipped_paused' ? 'Week progression is paused' : 'Waiting for finalized scores for every eligible competitor') }, { status: 409 })
    }
    const resolved = await prisma.bigBrotherCycle.findUnique({ where: { id: current.id }, select: { vetoWinnerRosterId: true } })
    return NextResponse.json({ ok: true, vetoWinnerRosterId: resolved?.vetoWinnerRosterId })
  }
  if (!participants.includes(manualWinnerId)) return NextResponse.json({ error: 'Winner is not a veto participant' }, { status: 400 })
  const winnerId = manualWinnerId

  const setResult = await setVetoWinner(current.id, winnerId)
  if (!setResult.ok) {
    return NextResponse.json({ error: setResult.error ?? 'Set veto winner failed' }, { status: 400 })
  }

  await transitionPhase(current.id, 'VETO_DECISION_OPEN')
  await appendBigBrotherAudit(leagueId, config.configId, 'phase_transition', {
    action: 'resolve_veto_challenge',
    winnerId,
    mode: manualWinnerId ? 'manual' : config.challengeMode,
  })

  return NextResponse.json({ ok: true, vetoWinnerRosterId: winnerId })
}
