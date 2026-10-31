import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import { resolveConflict } from '@/lib/devy/conflictResolutionEngine'

export const dynamic = 'force-dynamic'

const RESOLUTIONS = new Set(['auto_resolved', 'commissioner_resolved', 'skipped'])

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

  const pending = await prisma.devyMergeConflict.findMany({
    where: { sessionId, resolution: 'pending' },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ conflicts: pending })
}

export async function PATCH(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as { conflictId?: string; resolution?: string; note?: string }
  const conflictId = body.conflictId?.trim()
  if (!conflictId || !body.resolution) {
    return NextResponse.json({ error: 'conflictId and resolution required' }, { status: 400 })
  }

  // resolveConflict throws on anything else, which surfaced as a 500 for a bad request.
  if (!RESOLUTIONS.has(body.resolution)) {
    return NextResponse.json({ error: 'Invalid resolution' }, { status: 400 })
  }

  const c = await prisma.devyMergeConflict.findFirst({ where: { id: conflictId } })
  if (!c) return NextResponse.json({ error: 'Conflict not found' }, { status: 404 })

  const row = await prisma.devyImportSession.findFirst({ where: { id: c.sessionId } })
  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const gate = await assertLeagueCommissioner(row.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  await resolveConflict(conflictId, body.resolution, body.note, userId)
  const updated = await prisma.devyMergeConflict.findFirst({ where: { id: conflictId } })
  return NextResponse.json({ ok: true, conflict: updated })
}

