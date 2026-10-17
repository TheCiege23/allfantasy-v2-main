import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { aiCostGate } from '@/lib/ai-protection/costGate';
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
import { dynastyAnalyzerSectionsForClient } from '@/lib/trade-engine/dynastyAnalyzerClientView';
import type { TradeDecisionContextV1 } from '@/lib/trade-engine/trade-decision-context';
import { buildTradeAnalyzerIntelPrompt } from '@/lib/trade-engine/trade-analyzer-intel';
import { buildStableFallbackResponse, buildReliabilityMetadata } from '@/lib/ai-reliability';
import {
  tradeContextToEnvelope,
  getMandatorySystemPromptSuffix,
  normalizeToContract,
} from '@/lib/ai-context-envelope';
import { normalizeToSupportedSport } from '@/lib/sport-scope';
import { recordTradeSurfaceShadow } from '@/lib/decision-os/trade/surfaceShadow';
import { evaluateTrade, type EvaluateTradeDeps } from '@/lib/decision-os/trade/evaluateTrade';
import {
  NOT_YOUR_LEAGUE_REASON,
  resolveEvaluationLeagueId,
  resolveVerifiedPlatformLeagueId,
} from '@/lib/decision-os/trade/evaluationLeague';
import { receiptGradeFields } from '@/lib/decision-os/trade/receiptViews';
import { gradeInputsFromAssetLabels, splitSideAssets } from '@/lib/decision-os/trade/tradeGradeInputs';

type LabelAsset = { name: string; type?: 'player' | 'pick' | null }

function labelAssets(raw: unknown, fallbackSide: string): LabelAsset[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((a): a is { name: unknown; type?: unknown } => Boolean(a) && typeof a === 'object')
      .map((a): LabelAsset => ({
        name: String(a.name ?? ''),
        type: a.type === 'player' ? 'player' : a.type === 'pick' ? 'pick' : null,
      }))
      .filter((a) => a.name.trim().length > 0)
  }
  return splitSideAssets(fallbackSide).map((name) => ({ name, type: null }))
}

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

  const gated = await aiCostGate(req, 'trade_ai', session.user.id);
  if (gated) return gated;

  const includeTrace = wantsDebugTrace(req);
  const { sideA, sideB, leagueContext, leagueId, sport, gradeLeagueId, gradeSideA, gradeSideB } = await req.json();

  if (!sideA || !sideB) {
    return NextResponse.json(
      { error: 'Both sides of the trade are required' },
      { status: 400 },
    );
  }

  try {
    const normalizedSport = normalizeToSupportedSport(sport);
    const userId = session.user.id
    const parsedLeague = parseLeagueContext(leagueContext)
    /*
     * 🛑 A CLIENT'S `leagueId` IS NOT A LEAGUE THE CALLER MAY READ. It used to be set here as given, and
     * the assembler below reads manager tendencies, competitor snapshots, trade history and league values
     * `where: { platformLeagueId }` — all written into the AI prompt, so naming another league's id got
     * its derived manager data narrated back. Now only a league the caller owns or has a team in is used,
     * as its `platformLeagueId` (the key the assembler matches on); anything else is analyzed league-blind.
     */
    const verifiedPlatformLeagueId = leagueId
      ? await resolveVerifiedPlatformLeagueId({ suppliedLeagueId: String(leagueId), userId })
      : null
    if (verifiedPlatformLeagueId) parsedLeague.leagueId = verifiedPlatformLeagueId
    parsedLeague.platform = parsedLeague.platform || normalizedSport

    const sideAAssets = splitSideAssets(String(sideA))
    const sideBAssets = splitSideAssets(String(sideB))

    /*
     * 🛑 THE LETTER IS THE ONE TRADE ENGINE'S (2026-09-27). This page printed two letters of its own —
     * the deterministic verdict's `fairnessGrade` and the AI section's — on scales no other surface
     * uses. `evaluateTrade()` grades the deal from TEAM A's side in the league the viewer chose.
     *
     * Orientation: each team's list is what that team GETS — the engine calls the side whose list is
     * worth more "favored" and the page labels it the winner — so Team A gives B's list, gets A's.
     *
     * ⚠ `gradeLeagueId`, NOT `leagueId`: the grade's league goes through `resolveEvaluationLeagueId`,
     * which admits only a league the viewer owns or has a team in. (`leagueId` is gated the same way
     * above, for the context assembler.) `viewerSide: false` — the viewer is not proven to be Team A,
     * so roster need is not priced.
     *
     * Started here and awaited at the response, so it overlaps the AI stage rather than adding to it.
     */
    const evaluationReceiptPromise = (async () => {
      const evaluationLeagueId = await resolveEvaluationLeagueId({ suppliedLeagueId: gradeLeagueId ?? null, userId })
      const notYourLeague: Partial<EvaluateTradeDeps> =
        gradeLeagueId && !evaluationLeagueId
          ? { grade: async () => ({ graded: false, reason: NOT_YOUR_LEAGUE_REASON, basis: null }) }
          : {}
      return evaluateTrade(
        {
          surface: 'dynasty-trade-analyzer',
          leagueId: evaluationLeagueId,
          userId,
          give: gradeInputsFromAssetLabels(labelAssets(gradeSideB, String(sideB))),
          get: gradeInputsFromAssetLabels(labelAssets(gradeSideA, String(sideA))),
          viewerSide: false,
        },
        notYourLeague,
      )
    })()
    // An error path that returns before the response is built must not leave this rejection unhandled.
    evaluationReceiptPromise.catch(() => undefined)
    // Never fails the analysis: a grade that cannot be taken is a withheld grade with the reason.
    const tradeGradePayload = async () => {
      try {
        return receiptGradeFields(await evaluationReceiptPromise)
      } catch {
        return receiptGradeFields({ receiptId: null, assets: [], grade: { graded: false, reason: 'This trade could not be graded just now.', basis: null } })
      }
    }

    const partyA: TradeParty = { name: 'Team A', assets: sideAAssets }
    const partyB: TradeParty = { name: 'Team B', assets: sideBAssets }

    const stageAStart = Date.now()
    const tradeContext = await assembleTradeDecisionContext(partyA, partyB, parsedLeague)
    const stageALatency = Date.now() - stageAStart

    console.log(`[dynasty-trade-analyzer] Stage A assembled in ${stageALatency}ms — ctx=${tradeContext.contextId}, ${tradeContext.dataQuality.assetsCovered}/${tradeContext.dataQuality.assetsTotal} assets (${tradeContext.dataQuality.coveragePercent}%), ${tradeContext.dataQuality.warnings.length} warnings`)

    const envelope = tradeContextToEnvelope(tradeContext, {
      leagueId: verifiedPlatformLeagueId,
      userId: session.user?.id ?? null,
    });
    const mandatorySuffix = getMandatorySystemPromptSuffix(envelope);
    const intelPrompt = await buildTradeAnalyzerIntelPrompt(tradeContext).catch(() => '')
    const factLayerPrompt = [mandatorySuffix, contextToPromptV1(tradeContext), intelPrompt].filter(Boolean).join('\n\n')
    const dataGapsPrompt = buildDataGapsPrompt(tradeContext)

    const stageBStart = Date.now()
    const consensus = await runPeerReviewAnalysis({
      factLayerPrompt,
      dataGapsPrompt: dataGapsPrompt || undefined,
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
        leagueId: verifiedPlatformLeagueId,
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
      /*
       * 🛑 AI DOWN IS NOT A LICENCE FOR THE PRIVATE VERDICT (2026-09-29). This path sent the
       * deterministic engine's winner, verdict, confidence and reasons — whose first line IS its
       * verdict on the private scale ("Side A has a 12% value edge: 5,000 (A) vs 4,400 (B)"). The page
       * shows the one grade (`tradeGrade`) and the data warnings; the engine's verdict stays on the
       * server (the shadow above).
       */
      const normalizedOutput = normalizeToContract(
        {
          primaryAnswer: fallbackExplanation,
          suggestedNextAction: 'Review the league grade above; re-run when AI is available for narrative.',
        },
        envelope,
        { includeTrace: includeTrace, traceProvider: 'deterministic_fallback' }
      );
      return NextResponse.json({
        tradeGrade: await tradeGradePayload(),
        sections: null,
        analysis: {
          factors: [],
          reasons: [],
          counters: [],
          warnings: deterministicFallback.warnings,
          agingConcerns: deterministicFallback.warnings,
          recommendations: [],
        },
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

    /*
     * 🛑 THE RESPONSE NAMES NO WINNER BUT THE ONE GRADE'S (2026-09-29). It carried the dual-brain
     * engine's `winner`, `dynastyVerdict`, `deterministicVerdict` (winner label, fairness letter,
     * confidence, acceptance %, veto risk, side totals, deltas), the AI's own verdict and confidence,
     * and the private side totals in `stageA` — the page printed much of it beside the letter. The
     * engine's verdict stays on the server (the shadow above); `sections` is the allowlisted client
     * view (lib/trade-engine/dynastyAnalyzerClientView.ts). Its only consumer is DynastyTradeForm.
     */
    const primaryAnswer = gate.filteredReasons?.slice(0, 2).join('; ') || 'See the league grade and analysis.';
    const normalizedOutput = normalizeToContract(
      {
        primaryAnswer,
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
      tradeGrade: await tradeGradePayload(),
      sections: dynastyAnalyzerSectionsForClient(sections, gate.filteredCounters),
      normalizedOutput,
      ...(includeTrace && { trace: normalizedOutput.trace }),
      analysis: {
        factors: gate.filteredReasons,
        reasons: gate.filteredReasons,
        counters: gate.filteredCounters,
        warnings: gate.filteredWarnings,
        agingConcerns: gate.filteredWarnings.filter(w => w.toLowerCase().includes('age') || w.toLowerCase().includes('cliff') || w.toLowerCase().includes('declining')),
        recommendations: gate.filteredCounters.slice(0, 3),
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

