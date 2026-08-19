import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type NewsItem = {
  id: string
  title: string
  content: string | null
  source: string
  sourceUrl: string | null
  publishedAt: string | null
  category: string | null
}

type InjuryItem = {
  status: string | null
  type: string | null
  description: string | null
  date: string | null
  source: string
  /** True when the designation is past the port's 36h claim-freshness rule —
   *  render caveated, never plainly (a stale "Questionable" is a false statement). */
  stale: boolean
}

/**
 * GET /api/draft/player-detail?sport=NFL&playerId=4017
 *
 * Aggregates everything the player-click modal in the draft room needs:
 *   - core profile from SportsPlayer / SportsPlayerRecord (DB cache populated
 *     by the unified provider chain — RI → TSDB → API-Sports → ClearSports → Sleeper → ESPN)
 *   - injury history from SportsInjury
 *   - latest news from SportsNews (also written by the chain)
 *   - season stats + projections (already on SportsPlayerRecord)
 *
 * No external network calls — everything comes from the DB cache that the
 * importers + chain populate. The fall-back to "Player ${id}" is intentional
 * so the modal can still render even if the lookup misses.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = req.nextUrl.searchParams
  const playerIdRaw = (sp.get('playerId') || '').trim()
  if (!playerIdRaw) {
    return NextResponse.json({ error: 'playerId required' }, { status: 400 })
  }
  const sport = normalizeToSupportedSport(sp.get('sport') || playerIdRaw.split(':')[0] || 'NFL')

  // Try the SportsPlayerRecord first (richer, includes stats/projections/injury cache).
  const record = await prisma.sportsPlayerRecord.findUnique({
    where: { id: playerIdRaw.includes(':') ? playerIdRaw : `${sport}:${playerIdRaw}` },
  }).catch(() => null)

  // Fallback: SportsPlayer table (raw seed) by externalId or sleeperId.
  const seed =
    !record
      ? await prisma.sportsPlayer.findFirst({
          where: {
            sport,
            OR: [
              { externalId: playerIdRaw },
              { sleeperId: playerIdRaw },
              { externalId: playerIdRaw.replace(/^.*:/, '') },
            ],
          },
          orderBy: { fetchedAt: 'desc' },
        }).catch(() => null)
      : null

  const playerName = record?.name ?? seed?.name ?? null
  const team = record?.team ?? seed?.team ?? null

  // Last 6 news items for this player (by name match — SportsNews.playerId is sparse).
  const newsRows = playerName
    ? await prisma.sportsNews.findMany({
        where: {
          sport,
          OR: [{ playerId: playerIdRaw }, { playerName: { equals: playerName, mode: 'insensitive' } }],
        },
        orderBy: [{ publishedAt: 'desc' }, { fetchedAt: 'desc' }],
        take: 6,
      }).catch(() => [])
    : []

  const news: NewsItem[] = newsRows.map((n) => ({
    id: n.id,
    title: n.title,
    content: n.content,
    source: n.source,
    sourceUrl: n.sourceUrl,
    publishedAt: n.publishedAt ? n.publishedAt.toISOString() : null,
    category: n.category,
  }))

  // Slice 18 follow-on — current designation via the canonical injury read
  // port (position/team-verified name match, ambiguity REFUSED rather than
  // guessed). The old query ordered by `date desc`, which let a stale
  // api_sports row outrank a fresh rolling_insights one; the port's
  // freshest-source-wins rule is the fix. One canonical current row replaces
  // the previous list of provider duplicates.
  const injuryResolution = playerName
    ? await resolveInjuryFacts({
        sport,
        players: [
          {
            name: playerName,
            position: record?.position ?? seed?.position ?? null,
            team,
          },
        ],
      }).catch(() => null)
    : null
  const injuryFact = injuryResolution?.byPlayer.get(normalizeMatchName(playerName)) ?? null

  const injuries: InjuryItem[] = injuryFact
    ? [
        {
          status: typeof injuryFact.status === 'string' ? injuryFact.status : null,
          type: injuryFact.type,
          description: injuryFact.description,
          date: injuryFact.date ? injuryFact.date.toISOString() : null,
          source: injuryFact.source,
          stale: injuryFact.stale,
        },
      ]
    : []

  return NextResponse.json({
    playerId: playerIdRaw,
    sport,
    profile: {
      name: playerName ?? `Player ${playerIdRaw}`,
      team,
      position: record?.position ?? seed?.position ?? null,
      height: seed?.height ?? null,
      weight: seed?.weight ?? null,
      age: seed?.age ?? null,
      college: seed?.college ?? null,
      headshotUrl: record?.headshotUrl ?? seed?.imageUrl ?? null,
      injuryStatus: record?.injuryStatus ?? seed?.status ?? null,
      injuryNotes: record?.injuryNotes ?? null,
      adp: record?.adp ?? null,
      dynastyValue: record?.dynastyValue ?? null,
    },
    stats: record?.stats ?? null,
    projections: record?.projections ?? null,
    news,
    injuries,
    sources: {
      profile: record ? record.dataSource : seed ? seed.source : null,
      news: newsRows[0]?.source ?? null,
      injuries: injuryFact?.source ?? null,
    },
  })
}
