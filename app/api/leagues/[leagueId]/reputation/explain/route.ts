import { NextResponse } from 'next/server'
import { runUnifiedOrchestration } from '@/lib/ai-orchestration'
import { buildEnvelopeForTool, formatToolResult, validateToolOutput } from '@/lib/ai-tool-layer'
import {
  getReputationByLeagueAndManager,
  listEvidenceForManager,
} from '@/lib/reputation-engine/ManagerTrustQueryService'
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
 * POST /api/leagues/[leagueId]/reputation/explain
 * Body: { managerId }. Returns a short narrative explaining the manager's reputation (for AI "Explain" button).
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

    const body = await req.json().catch(() => ({}))
    const managerId = body.managerId
    if (!managerId) return NextResponse.json({ error: 'Missing managerId' }, { status: 400 })

    const seasonCandidate =
      typeof body?.season === 'number'
        ? body.season
        : typeof body?.season === 'string'
          ? parseInt(body.season, 10)
          : NaN
    const season =
      Number.isFinite(seasonCandidate) && !Number.isNaN(seasonCandidate) ? seasonCandidate : undefined
    const sport = typeof body?.sport === 'string' ? body.sport : undefined

    const reputation = await getReputationByLeagueAndManager(leagueId, managerId, {
      sport,
      season,
    })
    if (!reputation) {
      return NextResponse.json({
        leagueId,
        managerId,
        narrative: 'No reputation record yet. Run the reputation engine in league settings to generate trust scores.',
        source: 'none',
      })
    }

    const evidence = await listEvidenceForManager(leagueId, managerId, {
      sport: reputation.sport,
      season: reputation.season,
      limit: 10,
    }).catch(() => [])

    const parts: string[] = []
    parts.push(`Overall trust: ${reputation.tier} (${reputation.overallScore.toFixed(0)}/100).`)
    parts.push(`Reliability: ${reputation.reliabilityScore.toFixed(0)}. Activity: ${reputation.activityScore.toFixed(0)}. Trade fairness: ${reputation.tradeFairnessScore.toFixed(0)}.`)
    parts.push(`Sportsmanship: ${reputation.sportsmanshipScore.toFixed(0)}. Commissioner trust: ${reputation.commissionerTrustScore.toFixed(0)}. Toxicity risk: ${reputation.toxicityRiskScore.toFixed(0)}.`)
    if (evidence.length > 0) {
      parts.push(
        `Top evidence: ${evidence
          .slice(0, 4)
          .map((row) => `${row.evidenceType}=${Math.round(row.value)}`)
          .join(', ')}.`
      )
    }
    const fallback = parts.join(' ')

    const evidencePreview = evidence.slice(0, 10).map((row) => ({
      evidenceType: row.evidenceType,
      value: row.value,
      sourceReference: row.sourceReference,
      createdAt: row.createdAt,
    }))
    const envelope = buildEnvelopeForTool('psychological', {
      sport: reputation.sport,
      leagueId,
      deterministicPayload: {
        managerId,
        tier: reputation.tier,
        overallScore: reputation.overallScore,
        reliabilityScore: reputation.reliabilityScore,
        activityScore: reputation.activityScore,
        tradeFairnessScore: reputation.tradeFairnessScore,
        sportsmanshipScore: reputation.sportsmanshipScore,
        commissionerTrustScore: reputation.commissionerTrustScore,
        toxicityRiskScore: reputation.toxicityRiskScore,
        participationQualityScore: reputation.participationQualityScore,
        responsivenessScore: reputation.responsivenessScore,
        sport: reputation.sport,
        season: reputation.season,
        evidenceCount: evidence.length,
        evidence: evidencePreview,
      },
      behaviorPayload: {
        profileLabels: [reputation.tier],
      },
      userMessage:
        'Explain this manager reputation in 3-5 concise sentences. Highlight strongest strengths, biggest risk, and one practical commissioner action.',
    })
    const orchestration = await runUnifiedOrchestration({
      envelope,
      mode: 'consensus',
      options: { timeoutMs: 20_000, maxRetries: 1 },
    })

    let narrative = fallback
    let source: 'ai' | 'reputation_engine' = 'reputation_engine'
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
        toolKey: 'psychological',
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
      leagueId,
      managerId,
      narrative,
      source,
      verdict,
      sections,
      factGuardWarnings,
      tier: reputation.tier,
      overallScore: reputation.overallScore,
    })
  } catch (e) {
    console.error('[reputation/explain POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to explain reputation' },
      { status: 500 }
    )
  }
}
