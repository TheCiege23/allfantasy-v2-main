import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { getLeagueRole, requireCommissionerRole } from '@/lib/league/permissions'
import { submitKeeperSelections } from '@/lib/keeper/selectionEngine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const seasonId = req.nextUrl.searchParams?.get('seasonId')?.trim()
  const rosterId = req.nextUrl.searchParams?.get('rosterId')?.trim()
  if (!leagueId || !seasonId || !rosterId) {
    return NextResponse.json({ error: 'leagueId, seasonId, rosterId required' }, { status: 400 })
  }

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const records = await prisma.keeperRecord.findMany({ where: { leagueId, seasonId, rosterId } })
  return NextResponse.json({ records })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { rosterId?: string; leagueId?: string; seasonId?: string; playerIds?: string[] }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rosterId = body.rosterId?.trim()
  const leagueId = body.leagueId?.trim()
  const seasonId = body.seasonId?.trim()
  const playerIds = body.playerIds ?? []
  if (!rosterId || !leagueId || !seasonId) {
    return NextResponse.json({ error: 'rosterId, leagueId, seasonId required' }, { status: 400 })
  }

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const roster = await prisma.redraftRoster.findFirst({ where: { id: rosterId, leagueId } })
  if (!roster || roster.ownerId !== userId) {
    return NextResponse.json({ error: 'You can only edit your own roster' }, { status: 403 })
  }

  try {
    const result = await submitKeeperSelections(rosterId, leagueId, seasonId, playerIds)
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { keeperRecordId?: string; rosterId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rec = await prisma.keeperRecord.findFirst({
    where: { id: body.keeperRecordId, rosterId: body.rosterId },
  })
  if (!rec) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const gate = await assertLeagueMember(rec.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const roster = await prisma.redraftRoster.findFirst({ where: { id: rec.rosterId } })
  const role = await getLeagueRole(rec.leagueId, userId)
  const isComm = role === 'commissioner' || role === 'co_commissioner'
  if (!roster || (roster.ownerId !== userId && !isComm)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await prisma.keeperRecord.delete({ where: { id: rec.id } })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    keeperRecordId?: string
    leagueId?: string
    action?: string
    newCostRound?: number
  }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const leagueId = body.leagueId?.trim()
  if (!leagueId || !body.keeperRecordId) {
    return NextResponse.json({ error: 'leagueId and keeperRecordId required' }, { status: 400 })
  }

  try {
    await requireCommissionerRole(leagueId, userId, 'rosters')
  } catch (err) {
    if (err instanceof Response) return err
    throw err
  }

  const rec = await prisma.keeperRecord.update({
    where: { id: body.keeperRecordId },
    data: {
      status: body.action === 'reject' ? 'rejected' : 'confirmed',
      ...(body.newCostRound != null ? { costRound: body.newCostRound } : {}),
    },
  })

  await prisma.keeperAuditLog.create({
    data: {
      leagueId,
      seasonId: rec.seasonId,
      rosterId: rec.rosterId,
      action: 'commissioner_override',
      playerId: rec.playerId,
      playerName: rec.playerName,
      detail: { action: body.action, newCostRound: body.newCostRound },
      performedBy: userId,
    },
  })

  return NextResponse.json({ record: rec })
}

