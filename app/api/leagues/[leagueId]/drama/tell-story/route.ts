import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league-access'
import { getDramaEventById } from '@/lib/drama-engine/DramaQueryService'
import { buildDramaNarrative, buildTemplateNarrative } from '@/lib/drama-engine/AIDramaNarrativeAdapter'
import { buildAIRelationshipContext } from '@/lib/relationship-insights'
import { checkLeagueStoryAiGate } from '@/lib/league-story-ai/leagueStoryAiGate'

export const dynamic = 'force-dynamic'

type DramaEvent = NonNullable<Awaited<ReturnType<typeof getDramaEventById>>>

async function tellStory(leagueId: string, event: DramaEvent, opts: { ai: boolean }) {
  const relationshipContext = await buildAIRelationshipContext({
    leagueId,
    sport: event.sport,
    season: event.season,
    focusDramaEventId: event.id,
    focusManagerId: event.relatedManagerIds[0] ?? undefined,
  }).catch(() => null)

  const storylinePreview =
    relationshipContext?.payload &&
    Array.isArray((relationshipContext.payload as { storylines?: unknown[] }).storylines)
      ? (relationshipContext.payload as { storylines?: Array<{ headline?: string }> }).storylines?.[0]
          ?.headline ?? null
      : null

  const enrichedSummary = [event.summary, storylinePreview ? `Linked relationship storyline: ${storylinePreview}` : null]
    .filter(Boolean)
    .join(' ')

  const grounded = { ...event, summary: enrichedSummary || event.summary }
  const { narrative, source } = opts.ai ? await buildDramaNarrative(grounded) : buildTemplateNarrative(grounded)
  return { narrative, source, relationshipContextUsed: Boolean(relationshipContext) }
}

/**
 * POST /api/leagues/[leagueId]/drama/tell-story
 * Body: { eventId: string, lang?: 'en' | 'es' }
 * Returns narrative for "Tell me the story" button.
 *
 * 🛑 AF COMMISSIONER FOR THE WHOLE LEAGUE (owner, 2026-11-27). The narration is a model call, so it runs only
 * when the league's COMMISSIONER holds AF Commissioner or AF Supreme — then every member gets it — and at
 * most LEAGUE_STORY_AI_DAILY_LIMITS.drama times a league a day (lib/league-story-ai/leagueStoryAiGate.ts).
 * Locked or capped, the fact-built narrative from the event itself is served with `aiLocked`, no model.
 * This replaced the CALLER's own `storyline_creation` check with a token fallback, exactly as `story/create`
 * did: a token purchase must not buy model calls for a free commissioner's league, so nothing is charged.
 *
 * The request is still checked before the gate (2026-09-29 rule): a missing or foreign `eventId` costs no cap.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const session = (await getServerSession(authOptions as never)) as {
      user?: { id?: string; email?: string | null }
    } | null
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    try {
      await assertLeagueMember(leagueId, userId)
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await req.json().catch(() => ({}))) as { eventId?: unknown; lang?: unknown }
    const eventId = typeof body.eventId === 'string' ? body.eventId : ''
    if (!eventId) return NextResponse.json({ error: 'Missing eventId' }, { status: 400 })

    const event = await getDramaEventById(eventId)
    if (!event || event.leagueId !== leagueId) {
      return NextResponse.json({ error: 'Drama event not found' }, { status: 404 })
    }

    const aiGate = await checkLeagueStoryAiGate({ leagueId, kind: 'drama', lang: body.lang })
    const story = await tellStory(leagueId, event, { ai: aiGate.ok })

    return NextResponse.json({
      eventId,
      leagueId,
      narrative: story.narrative,
      source: story.source,
      headline: event.headline,
      dramaType: event.dramaType,
      relationshipContextUsed: story.relationshipContextUsed,
      aiLocked: aiGate.ok ? null : aiGate.body,
    })
  } catch (e) {
    console.error('[drama/tell-story POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to build story' },
      { status: 500 }
    )
  }
}

