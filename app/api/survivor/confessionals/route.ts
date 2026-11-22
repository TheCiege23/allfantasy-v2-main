import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveLeagueAccess } from '@/lib/league-access'
import { listMyConfessionals, revealedConfessionals, submitConfessional } from '@/lib/survivor/survivorConfessionals'

export const dynamic = 'force-dynamic'

async function viewer(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

/** The viewer's own confessionals, plus everyone's once the season is complete. League members only. */
export async function GET(req: NextRequest) {
  const userId = await viewer()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  if (!(await resolveLeagueAccess(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const [mine, revealed] = await Promise.all([listMyConfessionals(leagueId, userId), revealedConfessionals(leagueId)])
  return NextResponse.json({ mine, revealed }, { headers: { 'Cache-Control': 'no-store' } })
}

/** Record a confessional. */
export async function POST(req: NextRequest) {
  const userId = await viewer()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { leagueId?: unknown; text?: unknown } | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const text = typeof body?.text === 'string' ? body.text : ''
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  if (!(await resolveLeagueAccess(leagueId, userId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const result = await submitConfessional(leagueId, userId, text)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result)
}
