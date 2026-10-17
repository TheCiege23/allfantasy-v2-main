import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { toPlayedLeagues } from '@/lib/core-app/playedLeagues'
import { getWeeklyStory, getWeeklyStoryHeadline } from '@/lib/core-app/weeklyStory'

/**
 * GET /api/core/weekly-story?id=2026-W4 — Chimmy's cover line for your weekly story, fetched when
 * the viewer opens (user decision 2026-10-01: generate on open, so an unopened week costs nothing).
 *
 * 🛑 THE FACTS ARE RECOMPUTED HERE, NEVER TAKEN FROM THE REQUEST. A route that accepted the story
 * from the client would turn into a free text generator for anyone signed in, and a headline about
 * numbers the server never checked. The client sends only which week it is showing, and a mismatch
 * — the week rolled over between page render and open — returns the template rather than a line
 * about a different week.
 */

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })

  const wanted = request.nextUrl.searchParams.get('id')
  if (!wanted || !/^\d{4}-W\d{1,2}$/.test(wanted)) {
    return NextResponse.json({ error: 'Pass the story id, e.g. 2026-W4' }, { status: 400, headers })
  }

  try {
    const list = await getDashboardLeagueListForUser(userId, { rosterDetail: 'count' })
    const leagues = toPlayedLeagues((list?.leagues ?? []) as Array<Record<string, unknown>>).map((l) => ({
      id: String(l.id),
      name: typeof l.name === 'string' ? l.name : null,
      platform: typeof l.platform === 'string' ? l.platform : null,
      platformLeagueId: typeof l.platformLeagueId === 'string' ? l.platformLeagueId : null,
      season: (l.season as number | string | null | undefined) ?? null,
    }))
    const story = await getWeeklyStory({ userId, leagues, ownerSleeperId: list?.sleeperUserId ?? null })
    if (!story) return NextResponse.json({ error: 'No played week to tell yet' }, { status: 404, headers })
    if (story.id !== wanted) {
      return NextResponse.json({ id: story.id, headline: { text: story.templateHeadline, source: 'template' }, stale: true }, { headers })
    }
    const headline = await getWeeklyStoryHeadline(userId, story)
    return NextResponse.json({ id: story.id, headline }, { headers })
  } catch (error) {
    console.error('[api/core/weekly-story] failed', error instanceof Error ? error.message : 'unknown')
    return NextResponse.json({ error: 'Story unavailable' }, { status: 500, headers })
  }
}
