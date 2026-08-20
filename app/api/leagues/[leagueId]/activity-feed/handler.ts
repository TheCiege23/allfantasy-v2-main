import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { formatLeagueEventRow } from '@/lib/league-feed/leagueFeedFormatter'
import { getLeagueFeedSettings } from '@/lib/league-feed/leagueFeedSettings'

export const dynamic = 'force-dynamic'

type FeedItem = {
  id: string
  source: 'league_event' | 'activity_legacy'
  type: string
  message: string
  title?: string | null
  flavorLine?: string | null
  actorType?: string | null
  actorName?: string | null
  teamName?: string | null
  category?: string | null
  importance?: string | null
  botArchetypeLabel?: string | null
  visibility?: string | null
  createdAt: string
  metadata?: unknown
}

/**
 * GET — merged league feed: canonical `league_events` + legacy `activity_events` (backward compatible).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const elevated = await isElevatedCommissioner(leagueId, userId)

  const leagueRow = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  const feedPrefs = getLeagueFeedSettings(leagueRow?.settings)
  const showAiArchetypes = elevated || feedPrefs.showArchetypesPublic !== false

  const [leagueRows, legacyRows] = await Promise.all([
    prisma.leagueEvent.findMany({
      where: {
        leagueId,
        ...(elevated ? {} : { visibility: { not: 'commissioners_only' } }),
      },
      orderBy: { createdAt: 'desc' },
      take: 80,
      select: {
        id: true,
        eventType: true,
        title: true,
        description: true,
        visibility: true,
        payload: true,
        createdAt: true,
      },
    }),
    prisma.activityEvent.findMany({
      where: { leagueId },
      orderBy: { createdAt: 'desc' },
      take: 80,
      select: {
        id: true,
        type: true,
        message: true,
        metadata: true,
        createdAt: true,
      },
    }),
  ])

  const fromLeague: FeedItem[] = leagueRows.map((r) => {
    const f = formatLeagueEventRow({
      id: r.id,
      eventType: r.eventType,
      title: r.title,
      description: r.description,
      payload: r.payload,
      createdAt: r.createdAt,
    })
    return {
      id: f.id,
      source: 'league_event' as const,
      type: f.type,
      title: f.title,
      message: f.message,
      flavorLine: feedPrefs.aiFlavorEnabled ? f.flavorLine : null,
      actorType: f.actorType,
      actorName: f.actorName,
      teamName: f.teamName,
      category: f.category ?? null,
      importance: f.importance ?? null,
      botArchetypeLabel: showAiArchetypes ? f.botArchetypeLabel : null,
      visibility: r.visibility,
      metadata: f.metadata,
      createdAt: f.createdAt,
    }
  })

  const fromLegacy: FeedItem[] = legacyRows.map((r) => ({
    id: `ae:${r.id}`,
    source: 'activity_legacy',
    type: r.type,
    message: r.message,
    metadata: r.metadata,
    createdAt: r.createdAt.toISOString(),
  }))

  const merged = [...fromLeague, ...fromLegacy]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 80)

  return NextResponse.json({ items: merged })
}
