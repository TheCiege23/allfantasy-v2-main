import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueMember } from '@/lib/league-access'
import { getDramaEventById } from '@/lib/drama-engine/DramaQueryService'
import { buildDramaNarrative } from '@/lib/drama-engine/AIDramaNarrativeAdapter'
import { buildAIRelationshipContext } from '@/lib/relationship-insights'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { refundStorylineSpend } from '@/lib/tokens/storylineSpendRefund'

export const dynamic = 'force-dynamic'

type DramaEvent = NonNullable<Awaited<ReturnType<typeof getDramaEventById>>>

async function tellStory(leagueId: string, event: DramaEvent) {
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

  const { narrative, source } = await buildDramaNarrative({
    ...event,
    summary: enrichedSummary || event.summary,
  })
  return { narrative, source, relationshipContextUsed: Boolean(relationshipContext) }
}

/**
 * POST /api/leagues/[leagueId]/drama/tell-story
 * Body: { eventId: string, confirmTokenSpend?: boolean }
 * Returns narrative for "Tell me the story" button.
 *
 * 🛑 THE REQUEST IS CHECKED BEFORE ANYTHING IS CHARGED (2026-09-29). The gate used to run first with
 * `confirmTokenSpend: true` hardcoded, so a click spent tokens with no question asked, and a missing
 * or foreign `eventId` was charged and then refused. Now a bad request costs nothing, tokens are
 * spent only when the client says the person confirmed the cost (`lib/tokens/clientTokenConfirm.ts`,
 * which turns the gate's 409 into that question), and a story that fails after the charge is refunded.
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

    const body = (await req.json().catch(() => ({}))) as { eventId?: unknown; confirmTokenSpend?: unknown }
    const eventId = typeof body.eventId === 'string' ? body.eventId : ''
    if (!eventId) return NextResponse.json({ error: 'Missing eventId' }, { status: 400 })

    const event = await getDramaEventById(eventId)
    if (!event || event.leagueId !== leagueId) {
      return NextResponse.json({ error: 'Drama event not found' }, { status: 404 })
    }

    const gate = await requireFeatureEntitlement({
      userId,
      userEmail: session?.user?.email,
      featureId: 'storyline_creation',
      allowTokenFallback: true,
      confirmTokenSpend: body.confirmTokenSpend === true,
      tokenRuleCode: 'ai_storyline_creation',
      tokenSourceType: 'league_drama_tell_story',
      tokenSourceId: `${leagueId}:${Date.now()}`,
      tokenDescription: 'League drama story narration',
      tokenMetadata: {
        leagueId,
        eventId,
      },
    })
    if (!gate.ok) return gate.response

    let story: Awaited<ReturnType<typeof tellStory>>
    try {
      story = await tellStory(leagueId, event)
    } catch (e) {
      if (gate.tokenSpend) {
        await refundStorylineSpend({ userId, ledgerId: gate.tokenSpend.id, surface: 'league_drama_tell_story' })
      }
      throw e
    }

    return NextResponse.json({
      eventId,
      leagueId,
      narrative: story.narrative,
      source: story.source,
      headline: event.headline,
      dramaType: event.dramaType,
      relationshipContextUsed: story.relationshipContextUsed,
      tokenSpend: gate.tokenSpend
        ? {
            ruleCode: gate.tokenPreview?.ruleCode ?? 'ai_storyline_creation',
            tokenCost: gate.tokenPreview?.tokenCost ?? null,
            balanceAfter: gate.tokenSpend.balanceAfter,
            ledgerId: gate.tokenSpend.id,
          }
        : null,
    })
  } catch (e) {
    console.error('[drama/tell-story POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to build story' },
      { status: 500 }
    )
  }
}
