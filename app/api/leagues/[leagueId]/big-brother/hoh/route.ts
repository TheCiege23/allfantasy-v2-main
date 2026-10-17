/**
 * [NEW] app/api/leagues/[leagueId]/big-brother/hoh/route.ts
 * POST: Run HOH challenge and assign winner. Supports all 3 challenge modes.
 * GET: Returns current HOH and eligible competitors for the current cycle.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isBigBrotherLeague, getBigBrotherConfig } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { getCurrentCycleForLeague, transitionPhase } from '@/lib/big-brother/BigBrotherPhaseStateMachine'
import { assignHOH, getEligibleHOHRosterIds } from '@/lib/big-brother/BigBrotherHOHEngine'
import { runAutomation } from '@/lib/big-brother/BigBrotherAutomationService'
import { applyHaveNotWaiverPenalties } from '@/lib/big-brother/BigBrotherHaveNotPenaltyService'
import { announceHOHWinner } from '@/lib/big-brother/BigBrotherChatAnnouncements'
import { getRosterDisplayNamesForLeague } from '@/lib/big-brother/ai/getRosterDisplayNames'
import { appendBigBrotherAudit } from '@/lib/big-brother/BigBrotherAuditLog'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  const config = await getBigBrotherConfig(leagueId)
  if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 500 })

  const current = await getCurrentCycleForLeague(leagueId)
  if (!current) return NextResponse.json({ error: 'No active cycle' }, { status: 404 })

  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: current.id },
    select: { hohRosterId: true, week: true, phase: true },
  })

  const eligible = await getEligibleHOHRosterIds(leagueId, config.configId, current.week, config.consecutiveHohAllowed)
  const names = await getRosterDisplayNamesForLeague(leagueId, eligible)

  return NextResponse.json({
    week: current.week,
    phase: cycle?.phase,
    hohRosterId: cycle?.hohRosterId ?? null,
    eligible,
    rosterDisplayNames: names,
    challengeMode: config.challengeMode,
  })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  const isBB = await isBigBrotherLeague(leagueId)
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })

  // Commissioner check
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } })
  if (!league || league.userId !== userId) {
    return NextResponse.json({ error: 'Commissioner only — HOH challenge must be triggered by commissioner' }, { status: 403 })
  }

  const config = await getBigBrotherConfig(leagueId)
  if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 500 })

  const current = await getCurrentCycleForLeague(leagueId)
  if (!current) return NextResponse.json({ error: 'No active cycle' }, { status: 404 })

  if (current.phase !== 'HOH_OPEN') {
    return NextResponse.json({ error: `Cannot assign HOH — phase is ${current.phase}, expected HOH_OPEN` }, { status: 400 })
  }

  const eligible = await getEligibleHOHRosterIds(leagueId, config.configId, current.week, config.consecutiveHohAllowed)
  if (eligible.length === 0) {
    return NextResponse.json({ error: 'No eligible HOH competitors' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  if (config.weekProgressionPaused) return NextResponse.json({ error: 'Week progression is paused' }, { status: 409 })
  const manualWinnerId = typeof body.winnerRosterId === 'string' ? body.winnerRosterId : null
  if (!manualWinnerId) {
    // Both commissioner buttons and scheduled challenges use finalized provider scores.
    const result = await runAutomation({ leagueId, action: 'auto_hoh', systemUserId: userId })
    if (!result.ok || result.actionTaken?.startsWith('skipped_')) {
      return NextResponse.json({ error: result.error ?? (result.actionTaken === 'skipped_paused' ? 'Week progression is paused' : 'Waiting for finalized scores for every eligible competitor') }, { status: 409 })
    }
    const advanced = await runAutomation({ leagueId, action: 'tick', systemUserId: userId })
    if (!advanced.ok) return NextResponse.json({ error: advanced.error ?? 'Could not open nominations' }, { status: 409 })
    const cycle = await prisma.bigBrotherCycle.findUnique({ where: { id: current.id }, select: { hohRosterId: true, phase: true } })
    const names = await getRosterDisplayNamesForLeague(leagueId, cycle?.hohRosterId ? [cycle.hohRosterId] : [])
    return NextResponse.json({ ok: true, hohRosterId: cycle?.hohRosterId, hohDisplayName: cycle?.hohRosterId ? names[cycle.hohRosterId] ?? cycle.hohRosterId : null, week: current.week, phase: cycle?.phase })
  }
  if (!eligible.includes(manualWinnerId)) return NextResponse.json({ error: 'Selected roster is not eligible for HOH' }, { status: 400 })
  const winnerId = manualWinnerId

  // Assign HOH
  const assignResult = await assignHOH(leagueId, config.configId, current.id, winnerId)
  if (!assignResult.ok) {
    return NextResponse.json({ error: assignResult.error ?? 'HOH assignment failed' }, { status: 500 })
  }

  // Transition to HOH_LOCKED then NOMINATION_OPEN
  await transitionPhase(current.id, 'HOH_LOCKED')
  await transitionPhase(current.id, 'NOMINATION_OPEN')

  // Apply Have-Not waiver penalties for this cycle (fire-and-forget, non-blocking).
  applyHaveNotWaiverPenalties(leagueId, current.id).catch(() => {})

  // Announce
  const names = await getRosterDisplayNamesForLeague(leagueId, [winnerId])
  await announceHOHWinner({
    leagueId,
    week: current.week,
    hohRosterId: winnerId,
    hohDisplayName: names[winnerId],
  })

  // Audit
  await appendBigBrotherAudit(leagueId, config.configId, 'hoh_assigned', {
    cycleId: current.id,
    week: current.week,
    winnerId,
    challengeMode: 'manual',
    eligibleCount: eligible.length,
  })

  return NextResponse.json({
    ok: true,
    hohRosterId: winnerId,
    hohDisplayName: names[winnerId] ?? winnerId,
    week: current.week,
    phase: 'NOMINATION_OPEN',
  })
}
