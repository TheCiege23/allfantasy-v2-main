import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requireCommissionerOnly } from '@/lib/league/permissions'
import { logAuditEntry, getFullAuditTrail } from '@/lib/zombie/auditService'
import { generateRulesDocument } from '@/lib/zombie/rulesDocGenerator'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const leagueId = searchParams?.get('leagueId')
  const type = searchParams?.get('type')
  if (!leagueId || type !== 'audit') return NextResponse.json({ error: 'leagueId and type=audit required' }, { status: 400 })

  await requireCommissionerOnly(leagueId, session.user.id)
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const entries = await getFullAuditTrail(z.id)
  return NextResponse.json({ entries })
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId : null
  const action = typeof body.action === 'string' ? body.action : null
  const reason = typeof body.reason === 'string' ? body.reason : 'Commissioner override'

  if (!leagueId || !action) return NextResponse.json({ error: 'leagueId and action required' }, { status: 400 })

  await requireCommissionerOnly(leagueId, session.user.id)
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (action === 'pause_league' || action === 'resume_league') {
    const pausing = action === 'pause_league'
    const changed = await prisma.zombieLeague.updateMany({
      where: {
        id: z.id,
        status: pausing ? 'active' : 'paused',
        ...(!pausing ? { currentWeek: { gt: 0 } } : {}),
      },
      data: { status: pausing ? 'paused' : 'active' },
    })
    if (changed.count !== 1) {
      return NextResponse.json({
        error: pausing ? 'Only an active league can be paused.' : 'Only a started, paused league can be resumed.',
      }, { status: 409 })
    }
    await logAuditEntry(z.id, {
      category: 'commissioner_override',
      action: pausing ? 'LEAGUE_PAUSED' : 'LEAGUE_RESUMED',
      description: reason,
      actorUserId: session.user.id,
      actorRole: 'commissioner',
    })
    return NextResponse.json({ ok: true, status: pausing ? 'paused' : 'active' })
  }

  if (action === 'generate_rules_doc') {
    const doc = await generateRulesDocument(z.id)
    return NextResponse.json({ ok: true, documentId: doc.id, version: doc.version })
  }

  if (action === 'override_status') {
    const userId = typeof body.userId === 'string' ? body.userId : null
    const newStatus = typeof body.newStatus === 'string' ? body.newStatus : null
    if (!userId || !newStatus) return NextResponse.json({ error: 'userId and newStatus required' }, { status: 400 })

    const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId } })
    if (!roster) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })

    const prev = await prisma.zombieLeagueTeam.findUnique({
      where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
    })
    await prisma.zombieLeagueTeam.update({
      where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
      data: { status: newStatus },
    })
    await logAuditEntry(z.id, {
      category: 'commissioner_override',
      action: 'COMMISSIONER_STATUS_OVERRIDE',
      description: reason,
      actorUserId: session.user.id,
      actorRole: 'commissioner',
      targetUserId: userId,
      targetStatus: newStatus,
      previousState: { status: prev?.status },
      newState: { status: newStatus },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'override_winnings') {
    const userId = typeof body.userId === 'string' ? body.userId : null
    const adjustment = typeof body.adjustmentAmount === 'number' ? body.adjustmentAmount : parseFloat(String(body.adjustmentAmount))
    if (!userId || !Number.isFinite(adjustment)) {
      return NextResponse.json({ error: 'userId and adjustmentAmount required' }, { status: 400 })
    }

    const paid = await prisma.zombiePaidConfig.findUnique({ where: { zombieLeagueId: z.id } })
    if (paid?.potIsLocked) return NextResponse.json({ error: 'Pot is locked' }, { status: 400 })

    const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId } })
    if (!roster) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })

    await prisma.zombieLeagueTeam.update({
      where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
      data: { totalWinnings: { increment: adjustment } },
    })
    await logAuditEntry(z.id, {
      category: 'commissioner_override',
      action: 'WINNINGS_ADJUSTED',
      description: reason,
      amount: adjustment,
      actorUserId: session.user.id,
      actorRole: 'commissioner',
      targetUserId: userId,
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'award_item') {
    const userId = typeof body.userId === 'string' ? body.userId : null
    const itemType = typeof body.itemType === 'string' ? body.itemType : null
    if (!userId || !itemType) return NextResponse.json({ error: 'userId and itemType required' }, { status: 400 })

    const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId } })
    if (!roster) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })

    const team = await prisma.zombieLeagueTeam.findUnique({
      where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
    })
    if (!team) return NextResponse.json({ error: 'Zombie team row missing' }, { status: 400 })

    if (z.sport === 'NFL') {
      const currentResolution = await prisma.zombieWeeklyResolution.findUnique({ where: { zombieLeagueId_week: { zombieLeagueId: z.id, week: z.currentWeek } }, select: { status: true } })
      if (currentResolution && currentResolution.status !== 'pending') return NextResponse.json({ error: 'Complete weekly settlement or its review before granting items.' }, { status: 409 })
      const { itemTransaction, lockItemLeague, lastStarterDeadline, refreshItemScores } = await import('@/lib/zombie/beta2025ItemService')
      const { reviveBetaTeamInTransaction } = await import('@/lib/zombie/beta2025ItemSettlement')
      const { WEAPON_POINTS } = await import('@/lib/zombie/beta2025Items')
      if (!itemType.includes('serum') && !WEAPON_POINTS[itemType]) return NextResponse.json({ error: 'Choose a 2025 serum or weapon.' }, { status: 400 })
      await itemTransaction(async tx => {
        await lockItemLeague(tx, leagueId)
        const current = await tx.zombieWeeklyResolution.findUnique({ where: { zombieLeagueId_week: { zombieLeagueId: z.id, week: z.currentWeek } } })
        if (current && current.status !== 'pending') throw new Error('Weekly settlement has started; retry the grant after it completes.')
        let activatesAtWeek = z.currentWeek
        if (z.status === 'active') {
          const season = await tx.redraftSeason.findFirst({ where: { leagueId, season: z.season }, select: { id: true } })
          const rr = season && await tx.redraftRoster.findFirst({ where: { seasonId: season.id, ownerId: userId }, select: { id: true } })
          const deadline = rr && await lastStarterDeadline(tx, rr.id, z.season, z.currentWeek).catch(() => null)
          if (!deadline || deadline.getTime() <= Date.now()) activatesAtWeek++
        }
        await tx.zombieTeamItem.create({ data: { teamStatusId: team.id, zombieLeagueId: z.id, userId, itemType, itemLabel: itemType, acquiredReason: reason, activatesAtWeek } })
        if (z.status === 'active') await reviveBetaTeamInTransaction(tx, team.id, z.currentWeek)
      })
      if (z.status === 'active') await refreshItemScores(leagueId, z.currentWeek).catch(() => {})
    } else {
    await prisma.zombieTeamItem.create({
      data: {
        teamStatusId: team.id,
        zombieLeagueId: z.id,
        userId,
        itemType,
        itemLabel: itemType,
        acquiredReason: reason,
      },
    })
    }
    await logAuditEntry(z.id, {
      category: 'item_acquisition',
      action: 'COMMISSIONER_ITEM_AWARD',
      description: reason,
      actorUserId: session.user.id,
      actorRole: 'commissioner',
      targetUserId: userId,
    })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

