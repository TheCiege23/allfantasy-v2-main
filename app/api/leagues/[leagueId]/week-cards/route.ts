import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { loadNativeLeagueWeekCards } from '@/server/services/nativeLeagueWeekCards'

/**
 * GET /api/leagues/[leagueId]/week-cards?week=N — every game in a native league's week as a card (both
 * teams, avatars, records, points, AF projection, win chance), for the League page's Matchups section.
 * Reads Postgres only. 404 for a league with no native season (imported leagues keep their own page).
 */
export async function GET(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: { id: true, season: true, sport: true, settings: true, leagueVariant: true, platform: true, platformLeagueId: true, playoffWeeksPerRound: true },
  })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const access = await resolveLeagueAccess(leagueId, session.user.id)
  if (!access?.isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const askedWeek = Number(req.nextUrl.searchParams.get('week'))
  const out = await loadNativeLeagueWeekCards({
    league,
    viewerUserId: session.user.id,
    week: Number.isInteger(askedWeek) && askedWeek >= 1 && askedWeek <= 60 ? askedWeek : undefined,
  }).catch((e: unknown) => {
    console.warn('[league/week-cards] failed', { leagueId, error: e instanceof Error ? e.message : String(e) })
    return null
  })
  if (!out) return NextResponse.json({ error: 'No season' }, { status: 404 })
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
}
