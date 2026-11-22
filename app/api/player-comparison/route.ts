import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { comparePlayersMulti, runTwoPlayerComparisonEngine, type ScoringFormat } from '@/lib/player-comparison-lab';
import type { LeagueScoringSettings } from '@/lib/player-comparison-lab/types';
import { FeatureGateService } from '@/lib/subscription/FeatureGateService';

export async function GET(req: NextRequest) {
  const playerA = req.nextUrl.searchParams?.get('playerA')?.trim();
  const playerB = req.nextUrl.searchParams?.get('playerB')?.trim();
  const sport = req.nextUrl.searchParams?.get('sport');
  const scoringFormatRaw = req.nextUrl.searchParams?.get('scoringFormat');
  let includeAIExplanation =
    req.nextUrl.searchParams?.get('includeAIExplanation') === 'true' ||
    req.nextUrl.searchParams?.get('includeAiExplanation') === 'true';
  let explanationGate: {
    requiredPlan: string | null;
    message: string;
    upgradePath: string;
  } | null = null;

  const scoringFormat =
    scoringFormatRaw && SCORING_FORMATS.includes(scoringFormatRaw as ScoringFormat)
      ? (scoringFormatRaw as ScoringFormat)
      : undefined;

  if (!playerA || !playerB) {
    return NextResponse.json(
      { error: 'Missing playerA or playerB' },
      { status: 400 }
    );
  }

  try {
    if (includeAIExplanation) {
      const session = (await getServerSession(authOptions as any)) as {
        user?: { id?: string; email?: string | null };
      } | null;
      if (!session?.user?.id) {
        includeAIExplanation = false;
        explanationGate = {
          requiredPlan: 'AF Pro',
          message: 'Sign in and upgrade to AF Pro for Chimmy player comparison explanations.',
          upgradePath: '/upgrade?plan=pro&feature=player_comparison_explanations',
        };
      } else {
        const gate = new FeatureGateService();
        const decision = await gate.evaluateUserFeatureAccess(
          session.user.id,
          'player_comparison_explanations',
          session.user.email
        );
        if (!decision.allowed) {
          includeAIExplanation = false;
          explanationGate = {
            requiredPlan: decision.requiredPlan,
            message: decision.message,
            upgradePath: decision.upgradePath,
          };
        }
      }
    }

    const result = await runTwoPlayerComparisonEngine({
      playerAName: playerA,
      playerBName: playerB,
      sport,
      scoringFormat,
      includeAIExplanation,
    });
    if (!result) {
      return NextResponse.json(
        { error: 'Could not resolve one or both players' },
        { status: 404 }
      );
    }
    return NextResponse.json({
      playerA: result.comparison.playerA,
      playerB: result.comparison.playerB,
      chartSeries: result.comparison.chartSeries,
      summaryLines: result.comparison.summaryLines,
      deterministic: result.deterministic,
      explanation: result.explanation,
      explanationGate,
      sport: result.sport,
    });
  } catch (e) {
    console.error('[player-comparison]', e);
    return NextResponse.json(
      { error: 'Comparison failed' },
      { status: 500 }
    );
  }
}

const SCORING_FORMATS: ScoringFormat[] = ['ppr', 'half_ppr', 'non_ppr'];

export async function POST(req: NextRequest) {
  let body: {
    players?: string[];
    sport?: string | null;
    scoringFormat?: string | null;
    leagueScoringSettings?: LeagueScoringSettings | null;
    includeAIExplanation?: boolean | null;
    includeAiExplanation?: boolean | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rawPlayers = Array.isArray(body.players) ? body.players : [];
  const players = rawPlayers.map((p) => String(p).trim()).filter(Boolean);
  if (players.length < 2 || players.length > 6) {
    return NextResponse.json(
      { error: 'Provide 2–6 player names in "players" array' },
      { status: 400 }
    );
  }

  const sport = body.sport != null ? String(body.sport).trim() || null : null;
  const scoringFormat = body.scoringFormat != null && SCORING_FORMATS.includes(body.scoringFormat as ScoringFormat)
    ? (body.scoringFormat as ScoringFormat)
    : 'ppr';
  const leagueScoringSettings =
    body.leagueScoringSettings &&
    typeof body.leagueScoringSettings === 'object'
      ? body.leagueScoringSettings
      : null;
  let includeAIExplanation = Boolean(body.includeAIExplanation ?? body.includeAiExplanation);
  let explanationGate: {
    requiredPlan: string | null;
    message: string;
    upgradePath: string;
  } | null = null;

  try {
    if (includeAIExplanation) {
      const session = (await getServerSession(authOptions as any)) as {
        user?: { id?: string; email?: string | null };
      } | null;
      if (!session?.user?.id) {
        includeAIExplanation = false;
        explanationGate = {
          requiredPlan: 'AF Pro',
          message: 'Sign in and upgrade to AF Pro for Chimmy player comparison explanations.',
          upgradePath: '/upgrade?plan=pro&feature=player_comparison_explanations',
        };
      } else {
        const gate = new FeatureGateService();
        const decision = await gate.evaluateUserFeatureAccess(
          session.user.id,
          'player_comparison_explanations',
          session.user.email
        );
        if (!decision.allowed) {
          includeAIExplanation = false;
          explanationGate = {
            requiredPlan: decision.requiredPlan,
            message: decision.message,
            upgradePath: decision.upgradePath,
          };
        }
      }
    }

    const result = await comparePlayersMulti(players, {
      sport: sport ?? undefined,
      scoringFormat,
      leagueScoringSettings,
    });
    if (!result) {
      return NextResponse.json(
        { error: 'Could not resolve enough players' },
        { status: 404 }
      );
    }

    let twoPlayerEngine:
      | {
          sport: string;
          deterministic: {
            recommendedSide: 'playerA' | 'playerB' | 'tie';
            recommendedPlayerName: string | null;
            confidencePct: number;
            basedOn: Array<'stats_comparison'>;
            summary: string;
            statComparisons: Array<{
              metricId: string;
              label: string;
              playerAValue: number | null;
              playerBValue: number | null;
              higherIsBetter: boolean;
              winner: 'playerA' | 'playerB' | 'tie' | 'none';
              edgeScore: number | null;
            }>;
          };
          explanation: {
            source: 'deterministic' | 'ai';
            text: string;
          };
        }
      | null = null;

    if (players.length === 2) {
      const engine = await runTwoPlayerComparisonEngine({
        playerAName: players[0],
        playerBName: players[1],
        sport: sport ?? undefined,
        scoringFormat,
        leagueScoringSettings,
        includeAIExplanation,
      });
      if (engine) {
        twoPlayerEngine = {
          sport: engine.sport,
          deterministic: engine.deterministic,
          explanation: engine.explanation,
        };
      }
    }

    return NextResponse.json({
      ...result,
      explanationGate,
      twoPlayerEngine,
    });
  } catch (e) {
    console.error('[player-comparison POST]', e);
    return NextResponse.json(
      { error: 'Comparison failed' },
      { status: 500 }
    );
  }
}

