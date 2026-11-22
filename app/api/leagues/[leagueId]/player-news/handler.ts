import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/player-news?names=A,B,C — recent news about the named players (the
 * viewer's roster, sent by the League page's News tab), newest first.
 *
 * Postgres only: reads `SportsNews`, which the news sync writes. No provider is called. Gated like
 * the league's other reads (`resolveLeagueAccess`). Matches a story on its primary player OR any player
 * it mentions (`playerNames`), case-insensitively on the primary name.
 */
export type LeaguePlayerNewsItem = {
  id: string
  title: string
  body: string | null
  source: string
  url: string | null
  playerName: string | null
  imageUrl: string | null
  publishedAt: string | null
}

const MAX_NAMES = 60
const LIMIT = 30

export async function GET(req: NextRequest, ctx: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await ctx.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((await resolveLeagueAccess(leagueId, userId)) == null) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const names = [
    ...new Set(
      String(req.nextUrl.searchParams.get('names') || '')
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n.length > 1),
    ),
  ].slice(0, MAX_NAMES)
  if (names.length === 0) return NextResponse.json({ items: [] })

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true } }).catch(() => null)
  const sport = String(league?.sport ?? 'NFL')

  const rows = await prisma.sportsNews
    .findMany({
      where: {
        sport: { equals: sport, mode: 'insensitive' },
        OR: [{ playerName: { in: names, mode: 'insensitive' } }, { playerNames: { hasSome: names } }],
      },
      orderBy: { publishedAt: 'desc' },
      take: LIMIT,
      select: { id: true, title: true, content: true, description: true, source: true, sourceUrl: true, playerName: true, imageUrl: true, publishedAt: true },
    })
    .catch(() => null)
  if (rows == null) return NextResponse.json({ error: 'News is unavailable right now' }, { status: 503 })

  const items: LeaguePlayerNewsItem[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.description ?? r.content ?? null,
    source: r.source,
    url: r.sourceUrl ?? null,
    playerName: r.playerName ?? null,
    imageUrl: r.imageUrl ?? null,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
  }))
  return NextResponse.json({ items })
}
