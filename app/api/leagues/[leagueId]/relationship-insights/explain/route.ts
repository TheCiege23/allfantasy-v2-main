import { NextResponse } from 'next/server'
import { runUnifiedOrchestration } from '@/lib/ai-orchestration'
import { buildEnvelopeForTool, formatToolResult, validateToolOutput } from '@/lib/ai-tool-layer'
import { buildAIRelationshipContext } from '@/lib/relationship-insights'
import { normalizeOptionalSportForRelationship } from '@/lib/relationship-insights/SportRelationshipResolver'
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

    const body = await req.json().catch(() => ({}))
    const seasonCandidate =
      typeof body?.season === 'number'
        ? body.season
        : typeof body?.season === 'string'
          ? parseInt(body.season, 10)
          : NaN
    const season =
      Number.isFinite(seasonCandidate) && !Number.isNaN(seasonCandidate) ? seasonCandidate : null
    const sport = normalizeOptionalSportForRelationship(body?.sport ?? null)

    const context = await buildAIRelationshipContext({
      leagueId,
      sport,
      season,
      focusManagerId:
        typeof body?.focusManagerId === 'string' ? body.focusManagerId.trim() : undefined,
      focusRivalryId:
        typeof body?.focusRivalryId === 'string' ? body.focusRivalryId.trim() : undefined,
      focusDramaEventId:
        typeof body?.focusDramaEventId === 'string' ? body.focusDramaEventId.trim() : undefined,
    })

    const fallback = (() => {
      const payload = context.payload as Record<string, unknown>
      const sportLabel = String(payload.sportLabel ?? payload.sport ?? 'league')
      const storylines = Array.isArray(payload.storylines)
        ? (payload.storylines as Array<{ headline?: string; storylineScore?: number }>)
        : []
      const top = storylines[0]
      if (top?.headline) {
        return `${top.headline} currently leads the ${sportLabel} storyline board, and the relationship graph suggests this thread is likely to stay active over the next slate.`
      }
      return `Relationship and storyline signals are synchronized for this ${sportLabel} league, with rivalry, behavior, graph, and drama data aligned for downstream AI explanation.`
    })()
    const payload = context.payload as Record<string, unknown>

    const envelope = buildEnvelopeForTool('rivalries', {
      sport,
      leagueId,
      deterministicPayload: {
        ...payload,
        promptContext: context.promptContext,
        focusManagerId:
          typeof body?.focusManagerId === 'string' ? body.focusManagerId.trim() : undefined,
        focusRivalryId:
          typeof body?.focusRivalryId === 'string' ? body.focusRivalryId.trim() : undefined,
        focusDramaEventId:
          typeof body?.focusDramaEventId === 'string' ? body.focusDramaEventId.trim() : undefined,
      },
      userMessage:
        'Explain the top relationship storyline in 3-5 concise sentences using graph intensity, rivalry context, behavior profile cues, and drama timeline evidence only.',
    })
    const orchestration = await runUnifiedOrchestration({
      envelope,
      mode: 'consensus',
      options: { timeoutMs: 20_000, maxRetries: 1 },
    })

    let narrative = fallback
    let source: 'ai' | 'template' = 'template'
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
        primaryAnswer: orchestration.response.primaryAnswer || fallback,
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
      narrative = formatted.output.narrative || orchestration.response.primaryAnswer || fallback
      source = 'ai'
      verdict = formatted.output.verdict
      sections = formatted.sections
      factGuardWarnings = warnings.length ? warnings : undefined
    }

    return NextResponse.json({
      narrative,
      source,
      verdict,
      sections,
      factGuardWarnings,
      context: context.payload,
    })
  } catch (e) {
    console.error('[relationship-insights/explain POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to explain relationship insights' },
      { status: 500 }
    )
  }
}
