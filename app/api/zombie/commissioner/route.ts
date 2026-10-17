import { NextResponse } from 'next/server'
import { getZombieRulesForLeague } from '@/lib/zombie/zombieRules'
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

  if (action === 'pause_league') {
    await prisma.zombieLeague.update({ where: { id: z.id }, data: { status: 'paused' } })
    await logAuditEntry(z.id, {
      category: 'commissioner_override',
      action: 'LEAGUE_PAUSED',
      description: reason,
      actorUserId: session.user.id,
      actorRole: 'commissioner',
    })
    return NextResponse.json({ ok: true })
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

    // The league's serum cap (Specialty tab), enforced where serums are granted.
    if (itemType.toLowerCase().includes('serum')) {
      const { serumMaxHold } = await getZombieRulesForLeague(leagueId, z.sport)
      const held = await prisma.zombieTeamItem.count({
        where: { teamStatusId: team.id, itemType: { contains: 'serum' }, isUsed: false },
      })
      if (held >= serumMaxHold) {
        return NextResponse.json({ error: `This team already holds the league's limit of ${serumMaxHold} serums.` }, { status: 409 })
      }
    }

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

