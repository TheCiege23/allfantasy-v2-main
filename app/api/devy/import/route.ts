import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import { createImportSession } from '@/lib/devy/importEngine'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as { leagueId?: string }
  const leagueId = body.leagueId?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueCommissioner(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const s = await createImportSession(leagueId, userId)
  return NextResponse.json({ session: s })
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sessionId = req.nextUrl.searchParams?.get('sessionId')?.trim()
  const leagueIdParam = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!sessionId && leagueIdParam) {
    // Past import sessions for a league — the commissioner's history list. Commissioner-only,
    // because sources name the external league each session pulled from.
    const gate = await assertLeagueCommissioner(leagueIdParam, userId)
    if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })
    const sessions = await prisma.devyImportSession.findMany({
      where: { leagueId: leagueIdParam },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        status: true,
        createdAt: true,
        mergedAt: true,
        sources: {
          select: { id: true, sourceType: true, sourcePlatform: true, classification: true, connectionStatus: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    return NextResponse.json({ sessions })
  }
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const row = await prisma.devyImportSession.findFirst({ where: { id: sessionId } })
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const gate = await assertLeagueMember(row.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  return NextResponse.json({ session: row, summary: row.summary })
}

