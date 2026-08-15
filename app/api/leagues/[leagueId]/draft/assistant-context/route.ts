import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getLatestNews } from '@/lib/data/news'
import { listInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { buildChimmySportDataDigest } from '@/lib/chimmy/chimmy-sport-data-digest'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function maxIsoDate(values: Array<string | null | undefined>): string | null {
  let max = 0
  for (const value of values) {
    if (!value) continue
    const stamp = new Date(value).getTime()
    if (Number.isFinite(stamp) && stamp > max) max = stamp
  }
  return max > 0 ? new Date(max).toISOString() : null
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true, name: true },
  })

  const sport = normalizeToSupportedSport(league?.sport ?? 'NFL')

  try {
    const [newsRows, injuryRows, chimmyDigest] = await Promise.all([
      getLatestNews(sport, 4),
      // Canonical injury read port. getInjuryReport reads injury_report_records,
      // which was orphaned when the cron moved to sports_injuries and froze at
      // 2026-04-28 — so the draft assistant was quoting 108-day-old designations
      // with a reportedAt the UI rendered as current.
      listInjuryFacts({ sport, limit: 25 }),
      buildChimmySportDataDigest({ sport, includeNewsApi: false }),
    ])

    const headlines = newsRows.slice(0, 4).map((row) => ({
      id: row.id,
      title: row.headline,
      playerName: row.playerName ?? null,
      team: row.team ?? null,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      source: row.source,
    }))

    // Stale rows are dropped, not relabelled: a draft board shows these beside
    // players you are about to pick, and a three-month-old designation there is
    // a confident claim about availability that nobody made today.
    const injuries = (injuryRows.facts ?? [])
      .filter((f) => !f.stale)
      .slice(0, 6)
      .map((f) => ({
        playerName: f.playerName,
        team: f.team ?? null,
        // Null means no designation stated, NOT healthy.
        status: f.status ?? 'no designation stated',
        note: f.description ?? null,
        reportedAt: (f.date ?? f.fetchedAt).toISOString(),
        source: f.source ?? null,
      }))

    const updatedAt = maxIsoDate([
      ...headlines.map((item) => item.publishedAt),
      ...injuries.map((item) => item.reportedAt),
    ])

    return NextResponse.json({
      ok: true,
      leagueName: league?.name ?? null,
      sport,
      headlines,
      injuries,
      sportsFeed: {
        available: headlines.length > 0 || injuries.length > 0,
        updatedAt,
        sourceKeys: chimmyDigest.sources,
        digest: chimmyDigest.text || null,
      },
    })
  } catch (error) {
    console.error('[draft/assistant-context GET]', error)
    return NextResponse.json({
      ok: true,
      leagueName: league?.name ?? null,
      sport,
      headlines: [],
      injuries: [],
      sportsFeed: {
        available: false,
        updatedAt: null,
        sourceKeys: [],
        digest: null,
      },
    })
  }
}
