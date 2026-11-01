import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sessionId = req.nextUrl.searchParams?.get('sessionId')?.trim()
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const row = await prisma.devyImportSession.findFirst({ where: { id: sessionId } })
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const gate = await assertLeagueMember(row.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const [playerMappings, managerMappings] = await Promise.all([
    prisma.devyPlayerMapping.findMany({ where: { sessionId } }),
    prisma.devyManagerMapping.findMany({ where: { sessionId } }),
  ])
  return NextResponse.json({ playerMappings, managerMappings })
}

export async function PATCH(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as {
    sessionId?: string
    mappingId?: string
    kind?: 'player' | 'manager'
    internalPlayerId?: string
    internalPlayerName?: string
    internalUserId?: string
    internalUsername?: string
    action?: 'confirm' | 'reject'
  }
  const sessionId = body.sessionId?.trim()
  const mappingId = body.mappingId?.trim()
  if (!sessionId || !mappingId || !body.action) {
    return NextResponse.json({ error: 'sessionId, mappingId, action required' }, { status: 400 })
  }
  if (body.action !== 'confirm' && body.action !== 'reject') {
    return NextResponse.json({ error: 'action must be confirm or reject' }, { status: 400 })
  }

  const row = await prisma.devyImportSession.findFirst({ where: { id: sessionId } })
  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const gate = await assertLeagueCommissioner(row.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const kind = body.kind ?? 'player'

  if (kind === 'manager') {
    const found = await prisma.devyManagerMapping.findFirst({ where: { id: mappingId, sessionId } })
    if (!found) return NextResponse.json({ error: 'Mapping not found' }, { status: 404 })
    const updated = await prisma.devyManagerMapping.update({
      where: { id: mappingId },
      data: {
        isConfirmedByCommissioner: body.action === 'confirm',
        internalUserId: body.internalUserId ?? undefined,
        internalUsername: body.internalUsername ?? undefined,
        requiresReview: body.action === 'reject',
      },
    })
    return NextResponse.json({ ok: true, managerMapping: updated })
  }

  const pf = await prisma.devyPlayerMapping.findFirst({ where: { id: mappingId, sessionId } })
  if (!pf) return NextResponse.json({ error: 'Mapping not found' }, { status: 404 })

  const updated = await prisma.devyPlayerMapping.update({
    where: { id: mappingId },
    data: {
      isConfirmedByCommissioner: body.action === 'confirm',
      internalPlayerId: body.internalPlayerId ?? undefined,
      // A commissioner who picks a different player (e.g. Chimmy's suggestion) sends its name too,
      // so the row and the audit show who it now points at instead of the old match's name.
      internalPlayerName: body.internalPlayerId ? (body.internalPlayerName ?? null) : undefined,
      requiresReview: body.action === 'reject',
    },
  })
  return NextResponse.json({ ok: true, playerMapping: updated })
}

