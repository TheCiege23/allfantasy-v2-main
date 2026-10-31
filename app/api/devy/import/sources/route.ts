import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { connectSource } from '@/lib/devy/importEngine'

export const dynamic = 'force-dynamic'

/** What the wizard shows per source. `rawData` stays server-side: it holds the external league's
 *  full user and roster payload, and the UI needs only counts. */
function summarizeSource(src: {
  id: string
  sourceType: string
  sourcePlatform: string | null
  classification: string | null
  connectionStatus: string
  importedAt: Date | null
  createdAt: Date
  rawData: unknown
}) {
  const raw = (src.rawData && typeof src.rawData === 'object' ? src.rawData : {}) as Record<string, unknown>
  let playerCount = 0
  if (Array.isArray(raw.players)) playerCount = raw.players.length
  else if (Array.isArray(raw.rosters)) {
    for (const r of raw.rosters as Array<{ players?: unknown }>) {
      if (Array.isArray(r?.players)) playerCount += r.players.length
    }
  }
  const league = raw.league as { season?: unknown } | undefined
  const seasonNum = league ? parseInt(String(league.season ?? ''), 10) : NaN
  return {
    id: src.id,
    sourceType: src.sourceType,
    sourcePlatform: src.sourcePlatform,
    classification: src.classification,
    connectionStatus: src.connectionStatus,
    importedAt: src.importedAt,
    createdAt: src.createdAt,
    playerCount,
    managerCount: Array.isArray(raw.users) ? raw.users.length : 0,
    season: Number.isFinite(seasonNum) ? seasonNum : null,
    hasError: typeof raw.error === 'string' && raw.error.length > 0,
  }
}

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sessionId = req.nextUrl.searchParams?.get('sessionId')?.trim()
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const row = await prisma.devyImportSession.findFirst({ where: { id: sessionId } })
  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const gate = await assertLeagueCommissioner(row.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const sources = await prisma.devyImportSource.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' } })
  return NextResponse.json({ sources: sources.map(summarizeSource) })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as {
    sessionId?: string
    sourceType?: string
    platform?: string
    classification?: string
    data?: Record<string, unknown>
  }
  const sessionId = body.sessionId?.trim()
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })

  const row = await prisma.devyImportSession.findFirst({ where: { id: sessionId } })
  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const gate = await assertLeagueCommissioner(row.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const src = await connectSource(
    sessionId,
    body.sourceType ?? 'manual',
    body.platform ?? 'custom',
    body.classification ?? 'nfl_roster',
    (body.data ?? {}) as Record<string, unknown>,
  )
  return NextResponse.json({ source: summarizeSource(src) })
}

export async function PATCH(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as { sessionId?: string; sourceId?: string; classification?: string }
  const sessionId = body.sessionId?.trim()
  const sourceId = body.sourceId?.trim()
  if (!sessionId || !sourceId || !body.classification) {
    return NextResponse.json({ error: 'sessionId, sourceId, classification required' }, { status: 400 })
  }

  const row = await prisma.devyImportSession.findFirst({ where: { id: sessionId } })
  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const gate = await assertLeagueCommissioner(row.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  await prisma.devyImportSource.updateMany({
    where: { id: sourceId, sessionId },
    data: { classification: body.classification },
  })
  await prisma.devyImportSession.update({
    where: { id: sessionId },
    data: { status: 'classified' },
  })
  const updated = await prisma.devyImportSource.findFirst({ where: { id: sourceId } })
  return NextResponse.json({ ok: true, source: updated ? summarizeSource(updated) : null })
}
