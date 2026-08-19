import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league-access'
import { listCommentary } from '@/lib/commentary-engine'
import { COMMENTARY_EVENT_TYPES, type CommentaryEventType } from '@/lib/commentary-engine/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/leagues/[leagueId]/commentary
 * Query: eventType, limit, cursor.
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
    try {
      await assertLeagueMember(leagueId, session.user.id)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = new URL(req.url)
    const eventTypeRaw = url.searchParams?.get('eventType')
    const eventType =
      eventTypeRaw == null
        ? undefined
        : COMMENTARY_EVENT_TYPES.includes(eventTypeRaw as CommentaryEventType)
          ? (eventTypeRaw as CommentaryEventType)
          : null
    if (eventType === null) {
      return NextResponse.json({ error: 'Invalid eventType' }, { status: 400 })
    }
    const parsedLimit = parseInt(url.searchParams?.get('limit') ?? '20', 10)
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 20
    const cursor = url.searchParams?.get('cursor') ?? undefined

    const result = await listCommentary({ leagueId, eventType, limit, cursor })
    return NextResponse.json(result)
  } catch (e) {
    console.error('[commentary GET]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to list commentary' },
      { status: 500 }
    )
  }
}
