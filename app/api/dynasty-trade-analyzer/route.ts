import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  assembleTradeDecisionContext,
  contextToPromptV1,
  type TradeParty,
  type LeagueContextInput,
} from '@/lib/trade-engine/trade-context-assembler';
import {
  runPeerReviewAnalysis,
} from '@/lib/trade-engine/dual-brain-trade-analyzer';
import { runQualityGate } from '@/lib/trade-engine/quality-gate';
import { formatTradeResponse, computeDeterministicVerdict } from '@/lib/trade-engine/trade-response-formatter';
import type { TradeDecisionContextV1 } from '@/lib/trade-engine/trade-decision-context';
import { buildTradeAnalyzerIntelPrompt } from '@/lib/trade-engine/trade-analyzer-intel';
import { buildStableFallbackResponse, buildReliabilityMetadata } from '@/lib/ai-reliability';
import {
  tradeContextToEnvelope,
  getMandatorySystemPromptSuffix,
  normalizeToContract,
} from '@/lib/ai-context-envelope';
import { normalizeToSupportedSport } from '@/lib/sport-scope';
import { getPlayerValuesContext } from '@/lib/player-values/playerValuesLoader';
import { recordTradeSurfaceShadow } from '@/lib/decision-os/trade/surfaceShadow';

function parseLeagueContext(raw: string | undefined): LeagueContextInput {
  if (!raw) return {}

  const lower = raw.toLowerCase()
  return {
    scoringType: lower.includes('half') ? 'Half PPR' : lower.includes('standard') ? 'Standard' : 'PPR',
    isSF: lower.includes('sf') || lower.includes('superflex') || lower.includes('super flex'),
    isTEP: lower.includes('tep') || lower.includes('te premium'),
    numTeams: (() => {
      const match = raw.match(/(\d+)\s*(?:team|man)/i)
      return match ? parseInt(match[1]) : 12
    })(),
  }
}

function buildDataGapsPrompt(ctx: TradeDecisionContextV1): string {
  const flags: string[] = []
  if (ctx.missingData.valuationsMissing.length > 0) flags.push(`Missing valuations for: ${ctx.missingData.valuationsMissing.join(', ')}`)
  if (ctx.missingData.injuryDataStale) flags.push('Injury data may be stale')
  if (ctx.missingData.tradeHistoryInsufficient) flags.push('Limited trade history available')
  if (ctx.missingData.adpMissing.length > 0) flags.push(`Missing ADP for: ${ctx.missingData.adpMissing.join(', ')}`)
  if (ctx.missingData.analyticsMissing.length > 0) flags.push(`Missing analytics for: ${ctx.missingData.analyticsMissing.join(', ')}`)

  if (flags.length === 0) return ''

  return `DATA GAPS (reduce confidence accordingly):\n${flags.map(f => `- ${f}`).join('\n')}`
}

function wantsDebugTrace(req: Request): boolean {
  try {
    const url = new URL(req.url);
    if (url.searchParams?.get('debug') === '1' || url.searchParams?.get('trace') === '1') return true;
    if (req.headers.get('x-af-debug') === '1' || req.headers.get('x-af-trace') === '1') return true;
  } catch {
    // ignore
  }
  return false;
}

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string };
  } | null;

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const includeTrace = wantsDebugTrace(req);
  const { sideA, sideB, leagueContext, leagueId, sport } = await req.json();

  if (!sideA || !sideB) {
    return NextResponse.json(
      { error: 'Both sides of the trade are required' },
      { status: 400 },
    );
  }

  try {
    const normalizedSport = normalizeToSupportedSport(sport);
    const parsedLeague = parseLeagueContext(leagueContext)
    if (leagueId) parsedLeague.leagueId = leagueId
    parsedLeague.platform = parsedLeague.platform || normalizedSport

    const sideAAssets = sideA.split(/,|and/i).map((s: string) => s.trim()).filter((s: string) => s.length > 1)
    const sideBAssets = sideB.split(/,|and/i).map((s: string) => s.trim()).filter((s: string) => s.length > 1)

    const partyA: TradeParty = { name: 'Team A', assets: sideAAssets }
    const partyB: TradeParty = { name: 'Team B', assets: sideBAssets }

    const stageAStart = Date.now()
    const tradeContext = await assembleTradeDecisionContext(partyA, partyB, parsedLeague)
    const stageALatency = Date.now() - stageAStart

    console.log(`[dynasty-trade-analyzer] Stage A assembled in ${stageALatency}ms — ctx=${tradeContext.contextId}, ${tradeContext.dataQuality.assetsCovered}/${tradeContext.dataQuality.assetsTotal} assets (${tradeContext.dataQuality.coveragePercent}%), ${tradeContext.dataQuality.warnings.length} warnings`)

    const envelope = tradeContextToEnvelope(tradeContext, {
      leagueId: leagueId ?? parsedLeague.leagueId ?? null,
      userId: session.user?.id ?? null,
    });
    const mandatorySuffix = getMandatorySystemPromptSuffix(envelope);
    const intelPrompt = await buildTradeAnalyzerIntelPrompt(tradeContext).catch(() => '')
    const factLayerPrompt = [mandatorySuffix, contextToPromptV1(tradeContext), intelPrompt].filter(Boolean).join('\n\n')
    const dataGapsPrompt = buildDataGapsPrompt(tradeContext)

    const playerValuesRef = getPlayerValuesContext({
      sport: normalizedSport,
      format: 'dynasty',
    })

    const stageBStart = Date.now()
    const consensus = await runPeerReviewAnalysis({
      factLayerPrompt,
      dataGapsPrompt: dataGapsPrompt || undefined,
      referenceContext: playerValuesRef || undefined,
    })
    const stageBLatency = Date.now() - stageBStart

    console.log(`[dynasty-trade-analyzer] Stage B completed in ${stageBLatency}ms`)

    // AF_TRADE_UNIFICATION_BRIEF Phase 2 shadow instrumentation (flag-gated,
    // never affects the response). Dynasty's weak point is free-text name
    // matching — no roster identity exists, so this emits the structured skip
    // plus the surface's own deterministic verdict for cross-comparison.
    const emitDynastyShadow = (verdict: string | null, confidence: number | null, deltaPct: number | null) =>
      recordTradeSurfaceShadow({
        surface: 'dynasty',
        userId: session.user?.id ?? null,
        leagueId: leagueId ?? parsedLeague.leagueId ?? null,
        assetsGive: sideAAssets.length,
        assetsGet: sideBAssets.length,
        surfaceVerdict: verdict,
        surfaceConfidence: confidence,
        surfaceValueDeltaPct: deltaPct,
        surfaceAnalysisMode: 'free_text_assets',
      })

    if (!consensus) {
      const { deterministicFallback, fallbackExplanation, reliability } = buildStableFallbackResponse(tradeContext);
      const detVerdictOnly = computeDeterministicVerdict(tradeContext).verdict;
      emitDynastyShadow(
        deterministicFallback.verdict ?? detVerdictOnly ?? null,
        deterministicFallback.confidence ?? null,
        tradeContext.valueDelta?.percentageDiff ?? null,
      )
      const normalizedOutput = normalizeToContract(
        {
          primaryAnswer: fallbackExplanation ?? detVerdictOnly,
          verdict: deterministicFallback.verdict ?? detVerdictOnly,
          confidencePct: deterministicFallback.confidence,
          confidenceLabel: deterministicFallback.confidence >= 70 ? 'high' : deterministicFallback.confidence >= 45 ? 'medium' : 'low',
          suggestedNextAction: 'Review the evidence above; re-run when AI is available for narrative.',
        },
        envelope,
        { includeTrace: includeTrace, traceProvider: 'deterministic_fallback' }
      );
      return NextResponse.json({
        sections: null,
        deterministicVerdict: detVerdictOnly,
        analysis: {
          winner: deterministicFallback.winner ?? 'Even',
          valueDelta: `Data-only result (AI unavailable). Confidence: ${deterministicFallback.confidence}%.`,
          factors: deterministicFallback.reasons,
          confidence: deterministicFallback.confidence,
          dynastyVerdict: deterministicFallback.verdict,
          vetoRisk: null,
          agingConcerns: deterministicFallback.warnings,
          recommendations: [],
        },
        deterministicFallback,
        fallbackExplanation,
        reliability,
        normalizedOutput,
        ...(includeTrace && { trace: normalizedOutput.trace }),
        hasAiConsensus: false,
      });
    }

    const gate = runQualityGate(consensus, tradeContext)

    console.log(`[dynasty-trade-analyzer] Quality gate: ${gate.passed ? 'PASSED' : 'SOFT-FAIL'} | det-conf=${gate.deterministicConfidence} llm-conf=${gate.originalLLMConfidence} → final=${gate.adjustedConfidence} | ${gate.violations.length} violations`)
    for (const v of gate.violations) {
      console.log(`  [${v.severity}] ${v.rule}: ${v.detail}`)
    }

    const sections = formatTradeResponse(consensus, tradeContext, gate)

    const detVerdict = sections.deterministicVerdict

    emitDynastyShadow(
      detVerdict.winnerLabel ?? null,
      detVerdict.confidence ?? null,
      detVerdict.netValueDeltaPct ?? tradeContext.valueDelta?.percentageDiff ?? null,
    )

    const primaryAnswer = [detVerdict.winnerLabel, gate.filteredReasons?.slice(0, 2).join('; ')].filter(Boolean).join(' — ') || consensus.verdict;
    const normalizedOutput = normalizeToContract(
      {
        primaryAnswer,
        verdict: consensus.verdict ?? detVerdict.winnerLabel,
        keyEvidence: gate.filteredReasons,
        confidencePct: gate.adjustedConfidence,
        confidenceLabel: gate.adjustedConfidence >= 70 ? 'high' : gate.adjustedConfidence >= 45 ? 'medium' : 'low',
        risksCaveats: gate.filteredWarnings,
        suggestedNextAction: gate.filteredCounters?.[0],
      },
      envelope,
      { includeTrace: includeTrace, traceProvider: consensus.meta?.consensusMethod ?? 'peer-review' }
    );

    return NextResponse.json({
      sections,
      deterministicVerdict: detVerdict,
      normalizedOutput,
      ...(includeTrace && { trace: normalizedOutput.trace }),
      analysis: {
        winner: detVerdict.winner === 'Even' ? 'Even' : `Side ${detVerdict.winner}`,
        verdict: detVerdict.winnerLabel,
        confidence: detVerdict.confidence,
        factors: gate.filteredReasons,
        reasons: gate.filteredReasons,
        counters: gate.filteredCounters,
        warnings: gate.filteredWarnings,
        valueDelta: `Side A total=${tradeContext.sideA.totalValue}, Side B total=${tradeContext.sideB.totalValue}, delta=${tradeContext.valueDelta.absoluteDiff} (${tradeContext.valueDelta.percentageDiff}%)`,
        dynastyVerdict: detVerdict.winnerLabel,
        vetoRisk: detVerdict.vetoRisk,
        fairnessGrade: detVerdict.fairnessGrade,
        fairnessScore: detVerdict.fairnessScore,
        netValueDelta: detVerdict.netValueDelta,
        netValueDeltaPct: detVerdict.netValueDeltaPct,
        acceptanceProbability: detVerdict.acceptanceProbability,
        acceptanceLikelihood: detVerdict.acceptanceLikelihood,
        keyDrivers: detVerdict.keyDrivers,
        agingConcerns: gate.filteredWarnings.filter(w => w.toLowerCase().includes('age') || w.toLowerCase().includes('cliff') || w.toLowerCase().includes('declining')),
        recommendations: gate.filteredCounters.slice(0, 3),
      },
      aiCommentary: {
        aiVerdict: consensus.verdict,
        aiConfidence: gate.adjustedConfidence,
        reasons: gate.filteredReasons,
        counters: gate.filteredCounters,
        warnings: gate.filteredWarnings,
        consensusMethod: consensus.meta.consensusMethod,
        source: 'ai-peer-review',
      },
      peerReview: {
        verdict: consensus.verdict,
        confidence: gate.adjustedConfidence,
        deterministicConfidence: gate.deterministicConfidence,
        originalLLMConfidence: gate.originalLLMConfidence,
        reasons: gate.filteredReasons,
        counters: gate.filteredCounters,
        warnings: gate.filteredWarnings,
        consensusMethod: consensus.meta.consensusMethod,
        confidenceAdjustment: consensus.meta.confidenceAdjustment,
      },
      qualityGate: {
        passed: gate.passed,
        violationCount: gate.violations.length,
        violations: gate.violations.map(v => ({
          rule: v.rule,
          severity: v.severity,
          detail: v.detail,
          adjustment: v.adjustment,
        })),
        deterministicConfidence: gate.deterministicConfidence,
        originalLLMConfidence: gate.originalLLMConfidence,
        confidenceAdjusted: gate.adjustedConfidence,
      },
      stageA: {
        contextId: tradeContext.contextId,
        version: tradeContext.version,
        assembledAt: tradeContext.assembledAt,
        valueDelta: tradeContext.valueDelta,
        sideATotalValue: tradeContext.sideA.totalValue,
        sideBTotalValue: tradeContext.sideB.totalValue,
        dataQuality: tradeContext.dataQuality,
        missingData: tradeContext.missingData,
        tradeHistoryStats: tradeContext.tradeHistoryStats,
        dataSources: tradeContext.dataSources,
      },
      meta: {
        pipeline: '2-stage-v2-deterministic-first',
        stageALatencyMs: stageALatency,
        stageBLatencyMs: stageBLatency,
        totalLatencyMs: stageALatency + stageBLatency,
        providers: consensus.meta.providers.map(p => ({
          provider: p.provider,
          latencyMs: p.latencyMs,
          schemaValid: p.schemaValid,
          error: p.error,
        })),
        consensusMethod: consensus.meta.consensusMethod,
        confidenceAdjustment: consensus.meta.confidenceAdjustment,
        qualityGatePassed: gate.passed,
      },
      reliability: buildReliabilityMetadata({
        providerResults: consensus.meta.providers.map(p => ({
          provider: p.provider,
          status: p.schemaValid && !p.error ? 'ok' : 'failed',
          error: p.error ?? undefined,
          latencyMs: p.latencyMs,
        })),
        confidence: gate.adjustedConfidence,
        usedDeterministicFallback: false,
        dataQualityWarnings: gate.filteredWarnings.slice(0, 5),
        hardViolation: gate.violations.some(v => v.severity === 'hard'),
      }),
      hasAiConsensus: true,
    });
  } catch (err) {
    console.error('[dynasty-trade-analyzer] Error:', err);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}

