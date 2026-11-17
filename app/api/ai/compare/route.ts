/**
 * POST /api/ai/compare — Run AI with multiple providers and return comparison (providerResults).
 * Same request contract as /api/ai/run; forces consensus mode so all providers run. Supports compare providers UI.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runUnifiedOrchestration } from '@/lib/ai-orchestration'
import {
  validateToolRequest,
  requestContractToUnified,
  unifiedResponseToContract,
  type AIToolRequestContract,
  type AIToolResponseContract,
} from '@/lib/ai-tool-registry'
import { formatToolResult, resolveToolKeyAlias, validateToolOutput } from '@/lib/ai-tool-layer'
import {
  normalizeToContract,
  toClientDeterministicEnvelope,
  type DeterministicContextEnvelope,
} from '@/lib/ai-context-envelope'
import type { AIContextEnvelope } from '@/lib/unified-ai/types'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'

function isRequestContract(body: Record<string, unknown>): boolean {
  return typeof body.tool === 'string' && typeof body.sport === 'string'
}

function getStructuredCandidate(response: { modelOutputs?: Array<{ model?: string; structured?: unknown }> }): Record<string, unknown> | null {
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

function resolveProviderUsed(response: AIToolResponseContract): string | undefined {
  const winning = response.providerResults.find((provider) => !provider.skipped && !provider.error)
  return winning?.provider
}

function toEvidenceStringsFromNormalized(normalizedOutput: NonNullable<AIToolResponseContract['normalizedOutput']>): string[] {
  if (Array.isArray(normalizedOutput.keyEvidence) && normalizedOutput.keyEvidence.length > 0) {
    return normalizedOutput.keyEvidence
  }
  if (Array.isArray(normalizedOutput.evidence) && normalizedOutput.evidence.length > 0) {
    return normalizedOutput.evidence.map((item) =>
      `${item.label}: ${item.value}${item.unit ? ` ${item.unit}` : ''}`
    )
  }
  return []
}

function extractSportsContextMeta(envelope: AIContextEnvelope): {
  source?: string
  state?: 'live' | 'cached' | 'stale' | 'missing'
  available: boolean
  keys: string[]
  missingCount: number
  attemptedSources: string[]
} {
  const stats = envelope.statisticsPayload && typeof envelope.statisticsPayload === 'object'
    ? (envelope.statisticsPayload as Record<string, unknown>)
    : null
  const sportsData = stats?.sportsData && typeof stats.sportsData === 'object'
    ? (stats.sportsData as Record<string, unknown>)
    : null
  const coverage = stats?.sportsDataCoverage && typeof stats.sportsDataCoverage === 'object'
    ? (stats.sportsDataCoverage as Record<string, unknown>)
    : null
  const missing = Array.isArray(coverage?.missing)
    ? coverage?.missing.filter((item): item is string => typeof item === 'string')
    : []
  const attemptedSources = Array.isArray(stats?.sportsDataAttemptedSources)
    ? stats?.sportsDataAttemptedSources.filter((item): item is string => typeof item === 'string')
    : []
  const rawState = typeof stats?.sportsDataState === 'string' ? stats.sportsDataState : undefined
  const state: 'live' | 'cached' | 'stale' | 'missing' =
    rawState === 'live' || rawState === 'cached' || rawState === 'stale'
      ? rawState
      : sportsData
        ? 'live'
        : 'missing'
  return {
    source: typeof stats?.sportsDataSource === 'string' ? stats.sportsDataSource : undefined,
    state,
    available: Boolean(sportsData && Object.keys(sportsData).length > 0),
    keys: sportsData ? Object.keys(sportsData) : [],
    missingCount: missing.length,
    attemptedSources,
  }
}

function attachDeterministicPresentation(
  responseContract: AIToolResponseContract,
  envelope: AIContextEnvelope
): AIToolResponseContract {
  const deterministicEnvelope = (envelope.deterministicContextEnvelope ?? null) as DeterministicContextEnvelope | null
  const providerUsed = resolveProviderUsed(responseContract)
  const sportsMeta = extractSportsContextMeta(envelope)
  if (!deterministicEnvelope) {
    return {
      ...responseContract,
      deterministicEnvelope: null,
      normalizedOutput: null,
      debugTrace: {
        traceId: responseContract.traceId ?? null,
        providerUsed,
        sportsDataSource: sportsMeta.source,
        sportsDataState: sportsMeta.state,
        sportsDataAvailable: sportsMeta.available,
        sportsDataKeys: sportsMeta.keys,
        sportsDataMissingCount: sportsMeta.missingCount,
        sportsDataAttemptedSources: sportsMeta.attemptedSources,
      },
    }
  }

  const normalizedOutput = normalizeToContract(
    {
      primaryAnswer: responseContract.aiExplanation,
      verdict: responseContract.verdict ?? undefined,
      keyEvidence: responseContract.evidence,
      confidencePct: typeof responseContract.confidence === 'number' ? responseContract.confidence : undefined,
      confidenceLabel: responseContract.confidenceLabel ?? undefined,
      confidenceReason: responseContract.confidenceReason ?? undefined,
      risksCaveats: responseContract.risksCaveats ?? [],
      suggestedNextAction: responseContract.suggestedNextAction ?? responseContract.actionPlan ?? undefined,
      alternatePath: responseContract.alternatePath ?? undefined,
    },
    deterministicEnvelope,
    {
      includeTrace: true,
      traceProvider: providerUsed,
    }
  )
  const normalizedEvidence = toEvidenceStringsFromNormalized(normalizedOutput)

  return {
    ...responseContract,
    evidence: responseContract.evidence.length > 0 ? responseContract.evidence : normalizedEvidence,
    confidence: responseContract.confidence ?? normalizedOutput.confidence?.scorePct ?? null,
    confidenceLabel: responseContract.confidenceLabel ?? normalizedOutput.confidence?.label ?? null,
    confidenceReason: responseContract.confidenceReason ?? normalizedOutput.confidence?.reason ?? null,
    uncertainty:
      responseContract.uncertainty ??
      normalizedOutput.uncertainty?.[0]?.what ??
      (sportsMeta.missingCount > 0 ? `Some sports context is unavailable (${sportsMeta.missingCount} missing item(s)).` : null) ??
      (normalizedOutput.caveats?.[0] ?? null),
    deterministicEnvelope: toClientDeterministicEnvelope(deterministicEnvelope, { includePayload: false }),
    normalizedOutput,
    debugTrace: {
      traceId: responseContract.traceId ?? null,
      toolId: deterministicEnvelope.toolId,
      envelopeId: deterministicEnvelope.envelopeId,
      providerUsed,
      dataQualitySummary: deterministicEnvelope.dataQualitySummary,
      confidenceCapped: Boolean(normalizedOutput.confidence?.cappedByData),
      uncertaintyCount: normalizedOutput.uncertainty?.length ?? 0,
      missingDataCount: normalizedOutput.missingData?.length ?? 0,
      sportsDataSource: sportsMeta.source,
      sportsDataState: sportsMeta.state,
      sportsDataAvailable: sportsMeta.available,
      sportsDataKeys: sportsMeta.keys,
      sportsDataMissingCount: sportsMeta.missingCount,
      sportsDataAttemptedSources: sportsMeta.attemptedSources,
    },
  }
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json(
      { code: 'unauthorized', message: 'Unauthorized', userMessage: 'You need to sign in to use this feature.' },
      { status: 401 }
    )
  }

  // AF Pro (`player_ai_recommendations`, owner's decision 2026-11-16): the AI workbench, before any provider call.
  const plan = await requireFeatureEntitlement({ userId: session.user.id, userEmail: (session?.user as { email?: string | null } | undefined)?.email ?? null, featureId: 'player_ai_recommendations' })
  if (!plan.ok) return plan.response

  let body: Record<string, unknown>
  try {
    const b = await req.json()
    body = typeof b === 'object' && b != null ? (b as Record<string, unknown>) : {}
  } catch {
    return NextResponse.json(
      {
        code: 'envelope_validation_failed',
        message: 'Invalid JSON',
        userMessage: 'Invalid request. Check that the body is valid JSON.',
      },
      { status: 400 }
    )
  }

  if (!isRequestContract(body)) {
    return NextResponse.json(
      {
        code: 'envelope_validation_failed',
        message: 'Request must include tool and sport (request contract).',
        userMessage: 'Use tool and sport for compare.',
      },
      { status: 400 }
    )
  }

  const contract = body as unknown as AIToolRequestContract
  const validation = validateToolRequest(contract.tool, contract.deterministicContext ?? undefined, {
    leagueSettings: contract.leagueSettings ?? null,
    sport: contract.sport ?? null,
  })
  if (!validation.valid) {
    return NextResponse.json(
      {
        code: 'envelope_validation_failed',
        message: validation.error,
        userMessage: validation.error ?? 'Unsupported tool or missing required context.',
      },
      { status: 400 }
    )
  }

  const unified = requestContractToUnified(contract, session.user.id)
  const compareRequest = {
    ...unified,
    mode: 'consensus' as const,
    envelope: {
      ...unified.envelope,
      modelRoutingHints: undefined,
    },
  }

  const result = await runUnifiedOrchestration(compareRequest)
  if (!result.ok) {
    return NextResponse.json(
      {
        code: result.error.code,
        message: result.error.message,
        userMessage: result.error.userMessage,
        provider: result.error.provider,
        traceId: result.error.traceId,
      },
      { status: result.status }
    )
  }

  let responseContract: AIToolResponseContract = unifiedResponseToContract(result.response)
  const toolLayerKey = resolveToolKeyAlias(contract.tool)
  if (toolLayerKey) {
    const formatted = formatToolResult({
      toolKey: toolLayerKey,
      primaryAnswer: responseContract.aiExplanation || result.response.primaryAnswer,
      structured: getStructuredCandidate(result.response),
      envelope: compareRequest.envelope,
      factGuardWarnings: result.response.factGuardWarnings ?? undefined,
    })
    const toolFactGuard = validateToolOutput(formatted.output, compareRequest.envelope)
    const outputConfidence =
      typeof formatted.output.confidence === 'number'
        ? formatted.output.confidence
        : formatted.output.confidence.pct ?? null
    const factGuardWarnings = Array.from(
      new Set([
        ...(responseContract.factGuardWarnings ?? []),
        ...formatted.factGuardWarnings,
        ...toolFactGuard.warnings,
        ...toolFactGuard.errors.map((err) => `Fact guard: ${err}`),
      ])
    )

    responseContract = {
      ...responseContract,
      aiExplanation: formatted.output.narrative ?? responseContract.aiExplanation,
      evidence: responseContract.evidence.length ? responseContract.evidence : formatted.output.keyEvidence,
      confidence: responseContract.confidence ?? outputConfidence,
      uncertainty:
        responseContract.uncertainty ??
        formatted.output.risksCaveats[0] ??
        (toolFactGuard.errors.length ? 'Some claims could not be fully validated against deterministic context.' : null),
      verdict: formatted.output.verdict,
      risksCaveats: formatted.output.risksCaveats,
      suggestedNextAction: formatted.output.suggestedNextAction,
      alternatePath: formatted.output.alternatePath ?? null,
      sections: formatted.sections,
      outputShape: {
        verdict: formatted.output.verdict,
        keyEvidence: formatted.output.keyEvidence,
        confidence: formatted.output.confidence,
        risksCaveats: formatted.output.risksCaveats,
        suggestedNextAction: formatted.output.suggestedNextAction,
        alternatePath: formatted.output.alternatePath,
      },
      factGuardWarnings,
    }
  }
  return NextResponse.json(attachDeterministicPresentation(responseContract, compareRequest.envelope))
}
