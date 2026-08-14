import { NextResponse } from 'next/server'
import { resolveProfileAccess } from '@/lib/psychological-profiles/ProfileAccess'
import { getProfileById } from '@/lib/psychological-profiles/ManagerBehaviorQueryService'
import { prisma } from '@/lib/prisma'
import { runUnifiedOrchestration } from '@/lib/ai-orchestration'
import { buildEnvelopeForTool, formatToolResult, validateToolOutput } from '@/lib/ai-tool-layer'

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
 * POST /api/leagues/[leagueId]/psychological-profiles/explain
 * Body: { profileId: string }
 * Returns a short narrative explanation of the manager's behavior profile (for "Explain this manager style" UI).
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  try {
    const { leagueId } = await ctx.params
    if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

    // An explanation is the profile in prose — the most revealing form of it.
    const access = await resolveProfileAccess(leagueId)
    if (!access.ok) {
      return NextResponse.json({ error: access.reason }, { status: access.status })
    }

    const body = await req.json().catch(() => ({}))
    const profileId = body.profileId
    if (!profileId) return NextResponse.json({ error: 'Missing profileId' }, { status: 400 })

    const profile = await getProfileById(profileId)
    if (!profile || profile.leagueId !== leagueId) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const evidence = await prisma.profileEvidenceRecord.findMany({
      where: { profileId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    const labelsSummary = profile.profileLabels.length > 0
      ? profile.profileLabels.join(', ')
      : 'No behavioral labels yet'

    const fallbackNarrative = [
      `Manager ${profile.managerId} has a ${profile.sportLabel} behavior profile.`,
      `Labels: ${labelsSummary}.`,
      `Scores — Aggression: ${profile.aggressionScore.toFixed(0)}, Activity: ${profile.activityScore.toFixed(0)}, Trade frequency: ${profile.tradeFrequencyScore.toFixed(0)}, Waiver focus: ${profile.waiverFocusScore.toFixed(0)}, Risk tolerance: ${profile.riskToleranceScore.toFixed(0)}.`,
      profile.evidenceCount && profile.evidenceCount > 0
        ? `Evidence: ${profile.evidenceCount} recorded signals (trades, waivers, rebuild/contention).`
        : 'Evidence is being collected.',
    ].join(' ')

    const evidencePreview = evidence.slice(0, 10).map((e) => ({
      evidenceType: e.evidenceType,
      value: e.value,
      sourceReference: e.sourceReference,
    }))
    const envelope = buildEnvelopeForTool('psychological', {
      sport: profile.sport,
      leagueId,
      deterministicPayload: {
        profile: {
          profileId,
          managerId: profile.managerId,
          labels: profile.profileLabels,
          aggressionScore: profile.aggressionScore,
          activityScore: profile.activityScore,
          tradeFrequencyScore: profile.tradeFrequencyScore,
          waiverFocusScore: profile.waiverFocusScore,
          riskToleranceScore: profile.riskToleranceScore,
        },
        evidence: evidencePreview,
        evidenceCount: profile.evidenceCount ?? evidencePreview.length,
      },
      behaviorPayload: {
        profileLabels: profile.profileLabels,
      },
      userMessage:
        'Explain this manager style in 2-4 sentences with one actionable takeaway. Stay deterministic-first and confidence-aware.',
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
        toolKey: 'psychological',
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
      profileId,
      leagueId,
      narrative,
      verdict,
      sections,
      factGuardWarnings,
      profileLabels: profile.profileLabels,
      evidencePreview: evidencePreview.slice(0, 5),
    })
  } catch (e) {
    console.error('[psychological-profiles/explain POST]', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to explain profile' },
      { status: 500 }
    )
  }
}
