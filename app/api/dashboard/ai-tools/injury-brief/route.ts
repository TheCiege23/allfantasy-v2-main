import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { listInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { isSupportedSport, SUPPORTED_SPORTS } from '@/lib/sport-scope'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = req.nextUrl.searchParams.get('sport') ?? 'ALL'
  const sportParam = raw === 'ALL' || raw === '' ? null : raw.toUpperCase()

  if (sportParam && !isSupportedSport(sportParam)) {
    return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
  }

  try {
    const sportWhereNews =
      sportParam != null
        ? { sport: sportParam }
        : { sport: { in: [...SUPPORTED_SPORTS] as unknown as string[] } }

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    const digestCacheKeys =
      sportParam != null
        ? [`grok_injury_digest:${sportParam}`]
        : SUPPORTED_SPORTS.map((s) => `grok_injury_digest:${s}`)

    /*
     * ⚠ INJURIES COME FROM THE CANONICAL READ PORT, nothing else. The two
     * sources this used to read were both wrong: SportsPlayerRecord.injuryStatus
     * is ~92% roster designation (INACT/ACT) rendered as if it were an injury,
     * and injuryReportRecord has no scheduled writer (measured months stale in
     * prod). The port serves SportsInjury — freshest source wins, staleness
     * flagged per row.
     */
    const portSports =
      sportParam != null ? [sportParam] : ([...SUPPORTED_SPORTS] as string[])

    const [newsRows, portFactLists, digestRows] = await Promise.all([
      prisma.sportsNews.findMany({
        where: {
          ...sportWhereNews,
          OR: [
            { category: { contains: 'injury', mode: 'insensitive' } },
            { title: { contains: 'injury', mode: 'insensitive' } },
            { title: { contains: 'questionable', mode: 'insensitive' } },
            { title: { contains: 'doubtful', mode: 'insensitive' } },
          ],
          publishedAt: { gte: since },
        },
        orderBy: { publishedAt: 'desc' },
        take: 15,
      }),
      Promise.all(
        portSports.map((s) => listInjuryFacts({ sport: s, limit: 25 }).catch(() => null))
      ),
      prisma.sportsDataCache.findMany({
        where: {
          cacheKey: { in: digestCacheKeys },
          expiresAt: { gt: new Date() },
        },
      }),
    ])

    const articles = newsRows.map((a) => ({
      id: a.id,
      sport: a.sport,
      title: a.title,
      source: a.source,
      sourceUrl: a.sourceUrl,
      publishedAt: a.publishedAt?.toISOString() ?? null,
      playerName: a.playerName,
    }))

    const playerInjuries = portSports
      .flatMap((s, i) =>
        (portFactLists[i]?.facts ?? []).map((f) => ({
          id: f.id,
          source: 'injury_feed' as const,
          sport: s,
          name: f.playerName,
          team: f.team ?? null,
          position: f.position ?? null,
          injuryStatus: f.status ?? null,
          injuryNotes: [f.description, f.stale ? `reported ${Math.round(f.ageHours / 24)}d ago` : null]
            .filter(Boolean)
            .join(' — ') || null,
          lastUpdated: new Date(f.fetchedAt).toISOString(),
        }))
      )
      .slice(0, 20)

    const grokInjuryDigests = digestRows
      .map((row) => {
        const d = row.data as {
          summary?: string
          bullets?: string[]
          sport?: string
          generatedAt?: string
        }
        const keySport = row.cacheKey.replace(/^grok_injury_digest:/, '')
        return {
          sport: (d.sport ?? keySport) as string,
          summary: d.summary ?? '',
          bullets: Array.isArray(d.bullets) ? d.bullets : [],
          generatedAt: d.generatedAt ?? row.createdAt.toISOString(),
        }
      })
      .filter((x) => x.summary.length > 0 || x.bullets.length > 0)

    /*
     * Kept as a key for the modal's merge, intentionally empty: its old source
     * (injuryReportRecord) has no scheduled writer. Everything real is in
     * playerInjuries above.
     */
    const injuryReports: Array<Record<string, never>> = []

    return NextResponse.json({
      articles,
      playerInjuries,
      injuryReports,
      grokInjuryDigests,
      fetchedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[dashboard/ai-tools/injury-brief]', e)
    return NextResponse.json({ error: 'Failed to load injury brief' }, { status: 500 })
  }
}
