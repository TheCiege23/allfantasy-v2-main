import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import { detectMergeConflicts, matchManagers, matchPlayers } from '@/lib/devy/identityMatchingEngine'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as { sessionId?: string; action?: string }
  const sessionId = body.sessionId?.trim()
  if (!sessionId || body.action !== 'run_matching') {
    return NextResponse.json({ error: 'sessionId and action run_matching required' }, { status: 400 })
  }

  const row = await prisma.devyImportSession.findFirst({ where: { id: sessionId } })
  if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const gate = await assertLeagueCommissioner(row.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const teams = await prisma.leagueTeam.findMany({ where: { leagueId: row.leagueId } })
  const existingLeagueManagers = teams.map(t => ({
    userId: t.claimedByUserId ?? undefined,
    username: undefined as string | undefined,
    displayName: t.ownerName,
  }))

  const players = await matchPlayers(sessionId)
  const managers = await matchManagers(sessionId, existingLeagueManagers)
  const conflicts = await detectMergeConflicts(sessionId)

  return NextResponse.json({ ok: true, players, managers, conflicts })
}

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

  const [players, managers, conflicts, teams] = await Promise.all([
    prisma.devyPlayerMapping.findMany({ where: { sessionId } }),
    prisma.devyManagerMapping.findMany({ where: { sessionId } }),
    prisma.devyMergeConflict.findMany({ where: { sessionId } }),
    prisma.leagueTeam.findMany({ where: { leagueId: row.leagueId } }),
  ])

  // The league's claimed teams, so the commissioner can link an unmatched external manager to the
  // AllFantasy user who should receive that roster. Unclaimed teams have no user to link.
  const leagueManagers = teams
    .filter(t => Boolean(t.claimedByUserId))
    .map(t => ({ userId: t.claimedByUserId as string, label: t.ownerName || t.teamName || (t.claimedByUserId as string) }))

  return NextResponse.json({ players, managers, conflicts, leagueManagers })
}

