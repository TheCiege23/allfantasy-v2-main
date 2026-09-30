import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { runMatchupSimulation } from '@/lib/simulation-engine/MatchupSimulator';
import { getMatchupSimulationInsight } from '@/lib/simulation-engine/MatchupSimulationInsightAI';
import { normalizeToSupportedSport } from '@/lib/sport-scope';
import { runUnifiedOrchestration } from '@/lib/ai-orchestration';
import { buildEnvelopeForTool, formatToolResult, validateToolOutput } from '@/lib/ai-tool-layer';

export const dynamic = 'force-dynamic';

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

export async function POST(req: NextRequest) {
  // Every call runs the model orchestration, which we pay for. It answered
  // anonymous callers with no limit.
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null;
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!rateLimit(`sim-matchup-insight:${userId}`, 10, 60_000).success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let body: {
    teamA?: { mean: number; stdDev?: number }
    teamB?: { mean: number; stdDev?: number }
    teamAName?: string
    teamBName?: string
    sport?: string
    iterations?: number
  } = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {}

  const meanA = Number(body.teamA?.mean ?? 0);
  const meanB = Number(body.teamB?.mean ?? 0);
  if (!Number.isFinite(meanA) || !Number.isFinite(meanB)) {
    return NextResponse.json(
      { error: 'teamA.mean and teamB.mean are required' },
      { status: 400 }
    );
  }

  const sport = body.sport ? normalizeToSupportedSport(body.sport) : 'NFL';
  const teamAName = String(body.teamAName ?? 'Team A').trim();
  const teamBName = String(body.teamBName ?? 'Team B').trim();

  try {
    const out = await runMatchupSimulation({
      sport,
      weekOrPeriod: 1,
      teamA: { mean: meanA, stdDev: body.teamA?.stdDev },
      teamB: { mean: meanB, stdDev: body.teamB?.stdDev },
      iterations: body.iterations,
    });
    const simulationSummary = {
      winProbabilityA: out.winProbabilityA,
      winProbabilityB: out.winProbabilityB,
      expectedScoreA: out.expectedScoreA,
      expectedScoreB: out.expectedScoreB,
      upsideScenario: out.upsideScenario,
      downsideScenario: out.downsideScenario,
      iterations: out.iterations,
    }

    const envelope = buildEnvelopeForTool('matchup', {
      sport,
      deterministicPayload: {
        matchupSummary: {
          teamAName,
          teamBName,
          projectedMargin: Number(out.expectedScoreA) - Number(out.expectedScoreB),
          winProbabilityA: out.winProbabilityA,
          winProbabilityB: out.winProbabilityB,
        },
        projections: simulationSummary,
      },
      simulationPayload: simulationSummary,
      userMessage:
        `Explain this matchup between ${teamAName} and ${teamBName} with deterministic evidence, caveats, and one next action.`,
    })

    const orchestration = await runUnifiedOrchestration({
      envelope,
      mode: 'specialist',
      options: { timeoutMs: 20_000, maxRetries: 1 },
    })

    let insight = await getMatchupSimulationInsight(out, teamAName, teamBName).catch(() => '')
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
      const getStringAnswer = (val: unknown) => {
        if (typeof val === 'string') return val
        if (val && typeof val === 'object' && 'matchupExplanation' in val && typeof val.matchupExplanation === 'string') {
          return val.matchupExplanation
        }
        return ''
      }
      const formatted = formatToolResult({
        toolKey: 'matchup',
        primaryAnswer:
          getStringAnswer(orchestration.response.primaryAnswer) ||
          getStringAnswer(insight) ||
          '',
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
      insight = formatted.output.narrative || orchestration.response.primaryAnswer || insight
      verdict = formatted.output.verdict
      sections = formatted.sections
      factGuardWarnings = warnings.length ? warnings : undefined
    }

    return NextResponse.json({
      simulation: simulationSummary,
      insight,
      verdict,
      sections,
      factGuardWarnings,
    });
  } catch (e) {
    console.error('[simulation/matchup/insight]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Insight failed' },
      { status: 500 }
    );
  }
}
