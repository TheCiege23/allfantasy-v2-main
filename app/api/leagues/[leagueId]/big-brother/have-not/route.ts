/**
 * GET  – returns current Have-Not roster IDs for the active cycle (computed or commissioner override).
 * POST – commissioner sets a manual Have-Not override for the active cycle.
 *        Override stored in bigBrotherCycle.tieBreakSeasonPoints as { haveNotOverride: string[] }.
 *        Immediately applies waiver penalties for designated rosters.
 */

import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isBigBrotherLeague, getBigBrotherConfig } from '@/lib/big-brother/BigBrotherLeagueConfig'
import { getCurrentCycleForLeague } from '@/lib/big-brother/BigBrotherPhaseStateMachine'
import { resolveHaveNotRosterIdsForCycle } from '@/lib/big-brother/BigBrotherChatChannels'
import { applyHaveNotWaiverPenalties } from '@/lib/big-brother/BigBrotherHaveNotPenaltyService'
import { getRosterDisplayNamesForLeague } from '@/lib/big-brother/ai/getRosterDisplayNames'
import { appendBigBrotherAudit } from '@/lib/big-brother/BigBrotherAuditLog'

export const dynamic = 'force-dynamic'

async function getHaveNotOverride(cycleId: string): Promise<string[] | null> {
  const cycle = await prisma.bigBrotherCycle.findUnique({
    where: { id: cycleId },
    select: { tieBreakSeasonPoints: true },
  })
  if (!cycle?.tieBreakSeasonPoints) return null
  const raw = cycle.tieBreakSeasonPoints as Record<string, unknown>
  if (Array.isArray(raw?.haveNotOverride)) return raw.haveNotOverride as string[]
  return null
}

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

  const current = await getCurrentCycleForLeague(leagueId)
  if (!current) return NextResponse.json({ haveNotRosterIds: [], source: 'none' })

  const override = await getHaveNotOverride(current.id)
  let haveNotRosterIds: string[]
  let source: 'commissioner_override' | 'computed'

  if (override !== null) {
    haveNotRosterIds = override
    source = 'commissioner_override'
  } else {
    haveNotRosterIds = await resolveHaveNotRosterIdsForCycle(leagueId, current.id)
    source = 'computed'
  }

  const names = await getRosterDisplayNamesForLeague(leagueId, haveNotRosterIds)

  return NextResponse.json({ haveNotRosterIds, source, rosterDisplayNames: names, week: current.week })
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params

  // Commissioner-only
  const [league, isBB] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } }),
    isBigBrotherLeague(leagueId),
  ])
  if (!isBB) return NextResponse.json({ error: 'Not a Big Brother league' }, { status: 404 })
  if (!league || !(await canCommissionerAct(leagueId, userId, 'league'))) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

  const config = await getBigBrotherConfig(leagueId)
  if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 500 })

  const current = await getCurrentCycleForLeague(leagueId)
  if (!current) return NextResponse.json({ error: 'No active cycle' }, { status: 404 })

  const body = await req.json().catch(() => ({}))

  // clear = true removes the override and reverts to computed
  if (body.clear === true) {
    const existing = await prisma.bigBrotherCycle.findUnique({
      where: { id: current.id },
      select: { tieBreakSeasonPoints: true },
    })
    const raw = (existing?.tieBreakSeasonPoints ?? {}) as Record<string, unknown>
    delete raw.haveNotOverride
    await prisma.bigBrotherCycle.update({
      where: { id: current.id },
      data: {
        tieBreakSeasonPoints: Object.keys(raw).length
          ? (raw as Prisma.InputJsonValue)
          : Prisma.DbNull,
      },
    })
    await appendBigBrotherAudit(leagueId, config.configId, 'phase_transition', {
      action: 'clear_have_not_override',
      week: current.week,
    })
    return NextResponse.json({ ok: true, cleared: true })
  }

  const haveNotRosterIds = body.haveNotRosterIds as string[] | undefined
  if (!Array.isArray(haveNotRosterIds)) {
    return NextResponse.json({ error: 'haveNotRosterIds array required' }, { status: 400 })
  }

  // Validate roster IDs exist in the league
  const validRosters = await prisma.roster.findMany({
    where: { leagueId, id: { in: haveNotRosterIds } },
    select: { id: true },
  })
  const validIds = new Set(validRosters.map((r) => r.id))
  const invalid = haveNotRosterIds.filter((id) => !validIds.has(id))
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Unknown roster IDs: ${invalid.join(', ')}` }, { status: 400 })
  }

  // Merge override into existing tieBreakSeasonPoints JSON
  const existing = await prisma.bigBrotherCycle.findUnique({
    where: { id: current.id },
    select: { tieBreakSeasonPoints: true },
  })
  const raw = ((existing?.tieBreakSeasonPoints ?? {}) as Record<string, unknown>)
  raw.haveNotOverride = haveNotRosterIds

  await prisma.bigBrotherCycle.update({
    where: { id: current.id },
    data: { tieBreakSeasonPoints: raw as Prisma.InputJsonValue },
  })

  // Apply waiver penalties immediately
  if (haveNotRosterIds.length > 0) {
    await applyHaveNotWaiverPenalties(leagueId, current.id).catch(() => undefined)
  }

  await appendBigBrotherAudit(leagueId, config.configId, 'phase_transition', {
    action: 'set_have_not_override',
    week: current.week,
    haveNotRosterIds,
  })

  const names = await getRosterDisplayNamesForLeague(leagueId, haveNotRosterIds)
  return NextResponse.json({ ok: true, haveNotRosterIds, rosterDisplayNames: names })
}
