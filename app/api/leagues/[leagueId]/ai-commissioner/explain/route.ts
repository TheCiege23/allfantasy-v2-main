import { assertCommissionerAccess } from '@/lib/league/commissionerAccess'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import {
  buildAiCacheKey,
  createSmokeAiResult,
  isAiResultCacheSmokeProviderEnabled,
  readAiResultCache,
  writeAiResultCache,
} from '@/lib/ai-result-cache'
import {
  buildDisputeContext,
  explainTradeFairnessInsight,
  getTradeFairnessByTradeId,
} from '@/lib/ai-commissioner'
import { buildAIPrestigeContext } from '@/lib/prestige-governance/AIPrestigeContextResolver'
import { getUnifiedManagerSummary } from '@/lib/prestige-governance/UnifiedPrestigeQueryService'
import { runUnifiedOrchestration } from '@/lib/ai-orchestration'
import { buildEnvelopeForTool, formatToolResult, validateToolOutput } from '@/lib/ai-tool-layer'

export const dynamic = 'force-dynamic'

const AI_COMMISSIONER_EXPLAIN_TTL_MS = 30 * 60 * 1000

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
  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await assertCommissionerAccess(leagueId, userId, 'league')
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Partial<{ alertId: string; tradeId: string }>
  const alertId = String(body.alertId ?? '').trim()
  const tradeId = String(body.tradeId ?? '').trim()
  if (!alertId && !tradeId) {
    return NextResponse.json({ error: 'alertId or tradeId is required' }, { status: 400 })
  }

  if (tradeId && !alertId) {
    const tradeInsight = await getTradeFairnessByTradeId({ leagueId, tradeId })
    if (!tradeInsight) return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
    const smokeProviderEnabled = isAiResultCacheSmokeProviderEnabled()

    const fallback = explainTradeFairnessInsight(tradeInsight)
    const tradeSport =
      typeof (tradeInsight as { sport?: string | null }).sport === 'string'
        ? (tradeInsight as { sport?: string | null }).sport
        : undefined
    const cacheInputs = {
      path: 'trade_fairness',
      leagueId,
      tradeId,
      sport: tradeSport ?? null,
      tradeInsight,
    }
    const { resultKey, inputHash } = buildAiCacheKey('ai-commissioner-explain', cacheInputs)
    const cached = await readAiResultCache(resultKey)
    if (cached?.resultJson && typeof cached.resultJson === 'object') {
      return NextResponse.json(cached.resultJson)
    }

    if (smokeProviderEnabled) {
      const smoke = createSmokeAiResult({
        feature: 'ai-commissioner-explain',
        leagueId,
        route: '/api/leagues/[leagueId]/ai-commissioner/explain',
        input: cacheInputs,
      })
      const smokeResponse = {
        narrative: smoke.text,
        source: 'ai' as const,
        verdict: null,
        sections: [
          {
            id: 'smoke_narrative',
            title: 'Smoke Narrative',
            content: smoke.text,
            type: 'narrative' as const,
          },
        ],
        factGuardWarnings: ['Smoke provider mode enabled: deterministic synthetic explanation.'],
        context: {
          leagueId,
          type: 'trade_fairness',
          tradeFairness: tradeInsight,
        },
      }
      await writeAiResultCache({
        resultKey,
        inputHash,
        feature: 'ai-commissioner-explain',
        scopeType: 'league',
        scopeId: leagueId,
        provider: 'smoke-provider',
        inputJson: cacheInputs,
        resultJson: smokeResponse,
        ttlMs: AI_COMMISSIONER_EXPLAIN_TTL_MS,
      })
      return NextResponse.json(smokeResponse)
    }

    const envelope = buildEnvelopeForTool('trade_analyzer', {
      sport: tradeSport,
      leagueId,
      userId,
      deterministicPayload: {
        leagueId,
        ...tradeInsight,
      },
      userMessage:
        'Explain trade fairness in 3-5 concise sentences with league-safe guidance. Include why the fairness score matters and what commissioner follow-up is appropriate.',
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
        toolKey: 'trade_analyzer',
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

    const responsePayload = {
      narrative,
      source,
      verdict,
      sections,
      factGuardWarnings,
      context: {
        leagueId,
        type: 'trade_fairness',
        tradeFairness: tradeInsight,
      },
    }

    if (source === 'ai') {
      writeAiResultCache({
        resultKey,
        inputHash,
        feature: 'ai-commissioner-explain',
        scopeType: 'league',
        scopeId: leagueId,
        provider: 'orchestration',
        inputJson: cacheInputs,
        resultJson: responsePayload,
        ttlMs: AI_COMMISSIONER_EXPLAIN_TTL_MS,
      }).catch(() => undefined)
    }

    return NextResponse.json(responsePayload)
  }

  const alert = await prisma.aiCommissionerAlert.findFirst({
    where: { alertId, leagueId },
  })
  if (!alert) return NextResponse.json({ error: 'Alert not found' }, { status: 404 })

  const sport = normalizeToSupportedSport(String(alert.sport))
  const relatedManagerIds = Array.isArray(alert.relatedManagerIds) ? alert.relatedManagerIds : []
  const [disputeContext, prestigeContext, relatedManagerSummaries] = await Promise.all([
    buildDisputeContext({
      leagueId,
      relatedTradeId: alert.relatedTradeId,
      relatedMatchupId: alert.relatedMatchupId,
    }),
    buildAIPrestigeContext(leagueId, sport).catch(() => null),
    Promise.all(
      relatedManagerIds
        .slice(0, 4)
        .map((managerId) =>
          getUnifiedManagerSummary(leagueId, String(managerId), sport).catch(() => null)
        )
    ).catch(() => []),
  ])
  const payload = {
    leagueId,
    sport,
    alert: {
      alertId: alert.alertId,
      alertType: alert.alertType,
      severity: alert.severity,
      headline: alert.headline,
      summary: alert.summary,
      relatedManagerIds,
      relatedTradeId: alert.relatedTradeId,
      relatedMatchupId: alert.relatedMatchupId,
      status: alert.status,
      createdAt: alert.createdAt.toISOString(),
    },
    disputeContext,
    prestigeContext,
    relatedManagerSummaries: relatedManagerSummaries.filter(Boolean),
  }
  const smokeProviderEnabled = isAiResultCacheSmokeProviderEnabled()
  const cacheInputs = {
    path: 'governance_alert',
    leagueId,
    alertId,
    sport,
    payload,
  }
  const { resultKey, inputHash } = buildAiCacheKey('ai-commissioner-explain', cacheInputs)
  const cached = await readAiResultCache(resultKey)
  if (cached?.resultJson && typeof cached.resultJson === 'object') {
    return NextResponse.json(cached.resultJson)
  }

  if (smokeProviderEnabled) {
    const smoke = createSmokeAiResult({
      feature: 'ai-commissioner-explain',
      leagueId,
      route: '/api/leagues/[leagueId]/ai-commissioner/explain',
      input: cacheInputs,
    })
    const smokeResponse = {
      narrative: smoke.text,
      source: 'ai' as const,
      verdict: null,
      sections: [
        {
          id: 'smoke_narrative',
          title: 'Smoke Narrative',
          content: smoke.text,
          type: 'narrative' as const,
        },
      ],
      factGuardWarnings: ['Smoke provider mode enabled: deterministic synthetic explanation.'],
      context: payload,
    }

    await writeAiResultCache({
      resultKey,
      inputHash,
      feature: 'ai-commissioner-explain',
      scopeType: 'league',
      scopeId: leagueId,
      provider: 'smoke-provider',
      inputJson: cacheInputs,
      resultJson: smokeResponse,
      ttlMs: AI_COMMISSIONER_EXPLAIN_TTL_MS,
    })
    return NextResponse.json(smokeResponse)
  }

  const fallback = `${alert.headline}: ${alert.summary} ${disputeContext.summary}`.trim()
  const severityToIntensity: Record<string, number> = {
    low: 35,
    medium: 55,
    high: 75,
    critical: 85,
  }
  const envelope = buildEnvelopeForTool('rivalries', {
    sport,
    leagueId,
    userId,
    deterministicPayload: {
      ...payload,
      intensityScore: severityToIntensity[String(alert.severity).toLowerCase()] ?? 50,
      compositeScore: severityToIntensity[String(alert.severity).toLowerCase()] ?? 50,
      relatedManagerCount: relatedManagerIds.length,
      relatedTradeId: alert.relatedTradeId,
      relatedMatchupId: alert.relatedMatchupId,
    },
    userMessage:
      'Explain in 3-5 concise sentences why this governance alert matters, what evidence supports it, and the safest commissioner next action without implying automatic rule overrides.',
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

  const responsePayload = {
    narrative,
    source,
    verdict,
    sections,
    factGuardWarnings,
    context: payload,
  }

  if (source === 'ai') {
    writeAiResultCache({
      resultKey,
      inputHash,
      feature: 'ai-commissioner-explain',
      scopeType: 'league',
      scopeId: leagueId,
      provider: 'orchestration',
      inputJson: cacheInputs,
      resultJson: responsePayload,
      ttlMs: AI_COMMISSIONER_EXPLAIN_TTL_MS,
    }).catch(() => undefined)
  }

  return NextResponse.json(responsePayload)
}
