import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { proxyToExisting } from '@/lib/api/proxy-adapter'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'

export async function POST(req: NextRequest, { params }: { params: { leagueId: string } }) {
  /*
   * 🛑 THIS ROUTE HAD NO AUTHENTICATION AT ALL — not a membership check, not even
   * a session check. It read a League row and used its `settings`, `scoring`,
   * `leagueVariant`, `isDynasty` and `leagueSize` to build the body it proxies to
   * /api/waiver-ai, which itself treats the session as optional
   * (`session?.user?.id ?? null`), so the whole chain was reachable anonymously.
   *
   * ⚠ AND THE ID IS GUESSABLE, WHICH IS WHAT MAKES THE EXTRA QUERY WORTH IT. The
   * `where` accepts `platformLeagueId` as well as our uuid, and a platform league
   * id is a PUBLIC Sleeper identifier — an attacker does not have to discover
   * anything to name a league here.
   */
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  /*
   * ⚠ TWO READS ON PURPOSE, AND THE FIRST DISCLOSES NOTHING. The route accepts
   * either id space but `resolveLeagueMembership` keys on `League.id`, so the id
   * must be resolved before it can be gated. This read selects `id` and nothing
   * else — it cannot leak settings, scoring or size — and the substantive read
   * happens only after membership is proved.
   */
  const identified = await prisma.league.findFirst({
    where: { OR: [{ id: params.leagueId }, { platformLeagueId: params.leagueId }] },
    select: { id: true },
  })
  if (!identified) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const membership = await resolveLeagueMembership(identified.id, session.user.id)
  if (!membership.ok) {
    return NextResponse.json(
      { error: membership.status === 404 ? 'Not found' : 'Forbidden' },
      { status: membership.status },
    )
  }

  const incoming = await req.json().catch(() => ({}))
  const league = await prisma.league.findFirst({
    where: { id: identified.id },
    select: {
      id: true,
      name: true,
      sport: true,
      leagueVariant: true,
      scoring: true,
      isDynasty: true,
      leagueSize: true,
      settings: true,
    },
  })
  const settings = league?.settings && typeof league.settings === 'object'
    ? (league.settings as Record<string, unknown>)
    : null
  const settingsSuperflex =
    settings?.isSuperflex ?? settings?.superflex ?? settings?.is_sf ?? settings?.sf
  const body = {
    ...(incoming && typeof incoming === 'object' ? incoming : {}),
    leagueId: params.leagueId,
    sport: league?.sport ?? incoming?.sport,
    leagueVariant: league?.leagueVariant ?? incoming?.leagueVariant,
    league: {
      ...(incoming?.league && typeof incoming.league === 'object' ? incoming.league : {}),
      league_id: params.leagueId,
      name: league?.name ?? incoming?.league?.name,
      sport: league?.sport ?? incoming?.league?.sport,
      leagueVariant: league?.leagueVariant ?? incoming?.league?.leagueVariant,
      format: league?.scoring ?? incoming?.league?.format,
      superflex: settingsSuperflex ?? incoming?.league?.superflex,
      isDynasty: league?.isDynasty ?? incoming?.league?.isDynasty,
      num_teams: league?.leagueSize ?? incoming?.league?.num_teams,
    },
  }
  return proxyToExisting(req, {
    targetPath: '/api/waiver-ai',
    query: { leagueId: params.leagueId },
    body,
  })
}
