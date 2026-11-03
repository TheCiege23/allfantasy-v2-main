import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league/league-access'
import { buildC2CDraftRoom } from '@/lib/c2c/draftFormatEngine'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const draftType = req.nextUrl.searchParams?.get('draftType')?.trim() ?? 'startup'
  const season = Number(req.nextUrl.searchParams?.get('season') ?? new Date().getFullYear())
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const room = await buildC2CDraftRoom(leagueId, draftType, season)
  return NextResponse.json({ draft: room })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId : ''
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  // This older endpoint only described pools; it never created a DraftSession. The real session
  // endpoint requires commissioner authority and handles the league's persisted draft settings.
  return NextResponse.json({
    initialized: false,
    error: 'Create the draft from league draft settings using the commissioner draft session endpoint.',
    sessionEndpoint: `/api/leagues/${encodeURIComponent(leagueId)}/draft/session`,
  }, { status: 409 })
}

