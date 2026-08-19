import { NextResponse } from 'next/server'
import { getRivalryById } from '@/lib/rivalry-engine/RivalryQueryService'
import { buildTimelineForRivalry } from '@/lib/rivalry-engine/RivalryTimelineBuilder'
import { getRivalryTierLabel } from '@/lib/rivalry-engine/RivalryTierResolver'
import { getRivalrySportLabel } from '@/lib/rivalry-engine/SportRivalryResolver'
import { listProfilesByLeague } from '@/lib/psychological-profiles/ManagerBehaviorQueryService'
import { listDramaEvents } from '@/lib/drama-engine/DramaQueryService'
import { runUnifiedOrchestration } from '@/lib/ai-orchestration'
import { buildEnvelopeForTool, formatToolResult, validateToolOutput } from '@/lib/ai-tool-layer'
import { requireLeagueApiAccess } from '@/lib/api/require-league-access'

export const dynamic = 'force-dynamic'

function getStructuredCandidate(response: {
  modelOutputs?: Array<{ model?: string; structured?: unknown }>
}): Record<string, unknown> | null {
  const openaiStructured = response.modelOutputs?.find(
    (item) => item.model === 'openai' && item.structured && typeof item.structured === 'object'
  )?.structured
  if (openaiStructured && typeof openaiStructured === 'object') {
    return openaiStructured as Record<string, unknown>
  }
  const anyStructured = response.modelOutputs?.find(
    (item) => item.structured && typeof item.structured === 'object'
  )?.structured
  return anyStructured && typeof anyStructured === 'object'
    ? (anyStructured as Record<string, unknown>)
    : null
}

/**
 * POST /api/leagues/[leagueId]/rivalries/explain
 * Body: { rivalryId: string }
 * Returns a short narrative explanation of the rivalry (for "Explain this rivalry" UI).
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
    // Membership gate. This route was reachable by anyone holding a league id.
    const gate = await requireLeagueApiAccess(leagueId)
    if (!gate.ok) return gate.response

    let body: { rivalryId?: string } = {}
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const rivalryId = body.rivalryId
    if (!rivalryId) return NextResponse.json({ error: 'Missing rivalryId' }, { status: 400 })

    const rivalry = await getRivalryById(rivalryId)
    if (!rivalry || rivalry.leagueId !== leagueId) {
      return NextResponse.json({ error: 'Rivalry not found' }, { status: 404 })
    }

    const [timeline, profileRows, linkedDrama] = await Promise.all([
      buildTimelineForRivalry(rivalryId),
      listProfilesByLeague(leagueId, {
        sport: rivalry.sport,
        managerAId: rivalry.managerAId,
        managerBId: rivalry.managerBId,
        limit: 4,
      }).catch(() => []),
      listDramaEvents(leagueId, {
        sport: rivalry.sport,
        limit: 50,
      })
        .then((events) =>
          events.filter((event) => {
            const managerHit =
              event.relatedManagerIds.includes(rivalry.managerAId) &&
              event.relatedManagerIds.includes(rivalry.managerBId)
            const teamHit =
              event.relatedTeamIds.includes(rivalry.managerAId) &&
              event.relatedTeamIds.includes(rivalry.managerBId)
            return managerHit || teamHit
          })
        )
        .catch(() => []),
    ])
    const tierLabel = getRivalryTierLabel(rivalry.rivalryTier)
    const sportLabel = getRivalrySportLabel(rivalry.sport)

    const fallbackNarrative = [
      `This is a ${tierLabel.toLowerCase()} rivalry in ${sportLabel}.`,
      `Managers ${rivalry.managerAId} and ${rivalry.managerBId} have a rivalry score of ${rivalry.rivalryScore.toFixed(1)}/100.`,
      rivalry.eventCount && rivalry.eventCount > 0
        ? `The timeline includes ${rivalry.eventCount} recorded events (head-to-head matchups, close games, upsets, trades).`
        : 'History is still being collected for this pair.',
      profileRows.length > 0
        ? `Behavior profile context is available for ${profileRows.length} manager(s) in this rivalry.`
        : 'Behavior profile context is limited for this pair.',
      linkedDrama.length > 0
        ? `${linkedDrama.length} linked drama storyline(s) reinforce this rivalry thread.`
        : 'No linked drama storyline has been recorded yet.',
    ].join(' ')

    const timelinePreview = timeline.slice(0, 10).map((e) => ({
      eventType: e.eventType,
      season: e.season,
      description: e.description,
      createdAt: e.createdAt,
    }))
    const envelope = buildEnvelopeForTool('rivalries', {
      sport: rivalry.sport,
      leagueId,
      deterministicPayload: {
        rivalryId,
        managerAId: rivalry.managerAId,
        managerBId: rivalry.managerBId,
        compositeScore: rivalry.rivalryScore,
        intensityScore: rivalry.rivalryScore,
        rivalryTier: rivalry.rivalryTier,
        eventCount: rivalry.eventCount ?? 0,
        profileContext: profileRows.map((p) => ({
          managerId: p.managerId,
          profileLabels: p.profileLabels,
          activityScore: p.activityScore,
          riskToleranceScore: p.riskToleranceScore,
        })),
        linkedDrama: linkedDrama.slice(0, 5).map((d) => ({
          id: d.id,
          dramaType: d.dramaType,
          headline: d.headline,
          dramaScore: d.dramaScore,
        })),
        timelinePreview,
      },
      userMessage:
        'Explain why this rivalry matters now, what deterministic evidence supports it, and what to watch next.',
    })
    const orchestration = await runUnifiedOrchestration({
      envelope,
      mode: 'consensus',
      options: { timeoutMs: 20_000, maxRetries: 1 },
    })

    let narrative = fallbackNarrative
    let verdict: string | null = null
    let sections:
      | Array<{
          id: string
          title: string
          content: string
          type: 'verdict' | 'evidence' | 'confidence' | 'risks' | 'next_action' | 'alternate' | 'narrative'
        }>
      | undefined
    let factGuardWarnings: string[] | undefined

    if (orchestration.ok) {
      const formatted = formatToolResult({
        toolKey: 'rivalries',
        primaryAnswer: orchestration.response.primaryAnswer || fallbackNarrative,
        structured: getStructuredCandidate(orchestration.response),
        envelope,
        factGuardWarnings: orchestration.response.factGuardWarnings,
      })
      const factGuard = validateToolOutput(formatted.output, envelope)
      const warnings = Array.from(
        new Set([
          ...formatted.factGuardWarnings,
          ...factGuard.warnings,
          ...factGuard.errors.map((error) => `Fact guard: ${error}`),
        ])
      )
      narrative = formatted.output.narrative || orchestration.response.primaryAnswer || fallbackNarrative
      verdict = formatted.output.verdict
      sections = formatted.sections
      factGuardWarnings = warnings.length ? warnings : undefined
    }

    return NextResponse.json({
      rivalryId,
      leagueId,
      narrative,
      verdict,
      sections,
      factGuardWarnings,
      tier: rivalry.rivalryTier,
      score: rivalry.rivalryScore,
      eventCount: rivalry.eventCount,
      timelinePreview: timeline.slice(0, 5),
    })
  } catch (e) {
    console.error('[rivalries/explain POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to explain rivalry' },
      { status: 500 }
    )
  }
}
