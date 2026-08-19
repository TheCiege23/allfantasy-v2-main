import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league-access'
import { listArticles, generateArticle } from '@/lib/sports-media-engine'
import { isSupportedSport, normalizeToSupportedSport } from '@/lib/sport-scope'
import type { ArticleGenerationType } from '@/lib/sports-media-engine/types'

export const dynamic = 'force-dynamic'

const VALID_TYPES: ArticleGenerationType[] = [
  'weekly_recap',
  'power_rankings',
  'trade_breakdown',
  'upset_alert',
  'playoff_preview',
  'championship_recap',
]

/**
 * GET /api/leagues/[leagueId]/media
 * Query: sport, tags (comma-separated), limit, cursor.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    let access: { leagueSport: string }
    try {
      access = await assertLeagueMember(leagueId, session.user.id)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = new URL(req.url)
    const sportRaw = url.searchParams?.get('sport') ?? undefined
    const sport =
      sportRaw == null
        ? undefined
        : isSupportedSport(sportRaw)
          ? normalizeToSupportedSport(sportRaw)
          : null
    if (sport === null) {
      return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
    }
    if (sport && sport !== access.leagueSport) {
      return NextResponse.json({ error: 'Sport must match league sport' }, { status: 400 })
    }

    const tagsParam = url.searchParams?.get('tags')
    const tags = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : undefined
    const invalidTag = tags?.find((tag) => !VALID_TYPES.includes(tag as ArticleGenerationType))
    if (invalidTag) {
      return NextResponse.json({ error: `Invalid tag: ${invalidTag}` }, { status: 400 })
    }
    const limit = Math.min(parseInt(url.searchParams?.get('limit') ?? '20', 10) || 20, 50)
    const cursor = url.searchParams?.get('cursor') ?? undefined

    const result = await listArticles({
      leagueId,
      sport: sport ?? access.leagueSport,
      tags,
      limit,
      cursor,
    })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[media GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to list articles' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/leagues/[leagueId]/media
 * Body: { type: ArticleGenerationType, sport?, leagueName?, season?, week?, tradeSummary?, skipStatsInsights? }
 * Generates one article and returns { articleId, headline, tags }.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    let access: { leagueSport: string; isCommissioner: boolean }
    try {
      access = await assertLeagueMember(leagueId, session.user.id)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!access.isCommissioner) {
      return NextResponse.json({ error: 'Forbidden: commissioner only' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const type = (body.type as ArticleGenerationType) || 'weekly_recap'
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    const sportRaw = typeof body.sport === 'string' ? body.sport.trim() : undefined
    const sport =
      sportRaw == null || sportRaw.length === 0
        ? undefined
        : isSupportedSport(sportRaw)
          ? normalizeToSupportedSport(sportRaw)
          : null
    if (sport === null) {
      return NextResponse.json({ error: 'Invalid sport' }, { status: 400 })
    }
    if (sport && sport !== access.leagueSport) {
      return NextResponse.json({ error: 'Sport must match league sport' }, { status: 400 })
    }
    const weekValue =
      body.week == null || body.week === ''
        ? undefined
        : Number.isFinite(Number(body.week))
          ? Number(body.week)
          : undefined

    const result = await generateArticle({
      leagueId,
      sport: sport ?? access.leagueSport,
      leagueName: body.leagueName ?? undefined,
      season: body.season ?? undefined,
      week: weekValue,
      tradeSummary: body.tradeSummary ?? undefined,
      skipStatsInsights: !!body.skipStatsInsights,
      type,
    })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[media POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to generate article' },
      { status: 500 }
    )
  }
}
