import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { findLinkCandidates, findLinkCandidatesForSport, linkHalves } from '@/lib/league/collegePro/linkHalves'

export const dynamic = 'force-dynamic'

async function sessionUserId(): Promise<string | null> {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  return session?.user?.id ?? null
}

/**
 * The viewer's leagues that could be this league's other half (pro <-> college, matching sport).
 * `?sport=` instead of `?leagueId=` asks for a league not built yet: the import confirm screen.
 */
export async function GET(req: NextRequest) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  const sport = req.nextUrl.searchParams?.get('sport')?.trim()
  if (!leagueId && sport) {
    const bySport = await findLinkCandidatesForSport(userId, sport).catch(() => null)
    return bySport ? NextResponse.json(bySport) : NextResponse.json({ error: 'Could not load your leagues' }, { status: 500 })
  }
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  const found = await findLinkCandidates(leagueId, userId).catch(() => null)
  if (!found) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  return NextResponse.json(found)
}

/** Link two of the viewer's own leagues as one franchise. Body `{ leagueId, otherLeagueId }`. */
export async function POST(req: NextRequest) {
  const userId = await sessionUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { leagueId?: unknown; otherLeagueId?: unknown } | null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  const otherLeagueId = typeof body?.otherLeagueId === 'string' ? body.otherLeagueId.trim() : ''
  if (!leagueId || !otherLeagueId) return NextResponse.json({ error: 'Missing leagueId or otherLeagueId' }, { status: 400 })
  const result = await linkHalves({ leagueId, otherLeagueId, userId }).catch(() => ({ ok: false as const, error: 'Could not link these leagues.' }))
  return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: result.error }, { status: 400 })
}
