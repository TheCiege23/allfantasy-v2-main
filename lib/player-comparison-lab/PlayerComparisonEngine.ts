import { explainDeterministicOutput } from '@/lib/ai-explanation-layer';
import { normalizeToSupportedSport } from '@/lib/sport-scope';
import { comparePlayers } from './PlayerComparisonService';
import type {
  DeterministicStatComparisonRow,
  LeagueScoringSettings,
  ResolvedPlayerStats,
  ScoringFormat,
  TwoPlayerComparisonEngineResult,
} from './types';

type ComparedSide = 'playerA' | 'playerB' | 'tie' | 'none';

type MetricSpec = {
  metricId: string;
  label: string;
  higherIsBetter: boolean;
  weight: number;
  extract: (args: {
    playerA: ResolvedPlayerStats;
    playerB: ResolvedPlayerStats;
  }) => { playerAValue: number | null; playerBValue: number | null };
};

export interface TwoPlayerComparisonEngineInput {
  playerAName: string;
  playerBName: string;
  sport?: string | null;
  scoringFormat?: ScoringFormat;
  leagueScoringSettings?: LeagueScoringSettings | null;
  includeAIExplanation?: boolean;
  leagueWeekProjections?: { week: number | null; playerA: number | null; playerB: number | null };
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function toFpPerGame(row: {
  fantasyPointsPerGame?: number | null;
  fantasyPoints?: number | null;
  gamesPlayed?: number | null;
}): number | null {
  const direct = toFiniteNumber(row.fantasyPointsPerGame);
  if (direct != null) return direct;
  const points = toFiniteNumber(row.fantasyPoints);
  const games = toFiniteNumber(row.gamesPlayed);
  if (points == null || games == null || games <= 0) return null;
  return points / games;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveRowOutcome(args: {
  playerAValue: number | null;
  playerBValue: number | null;
  higherIsBetter: boolean;
}): { winner: ComparedSide; edgeScore: number | null } {
  const { playerAValue, playerBValue, higherIsBetter } = args;
  if (playerAValue == null && playerBValue == null) {
    return { winner: 'none', edgeScore: null };
  }
  if (playerAValue != null && playerBValue == null) {
    return { winner: 'playerA', edgeScore: null };
  }
  if (playerAValue == null && playerBValue != null) {
    return { winner: 'playerB', edgeScore: null };
  }
  if (playerAValue === playerBValue) {
    return { winner: 'tie', edgeScore: 0 };
  }

  const delta = higherIsBetter
    ? (playerAValue as number) - (playerBValue as number)
    : (playerBValue as number) - (playerAValue as number);
  const denominator = Math.max(Math.abs(playerAValue as number), Math.abs(playerBValue as number), 1);
  const edgeScore = delta / denominator;
  const winner: ComparedSide = edgeScore > 0 ? 'playerA' : 'playerB';
  return { winner, edgeScore };
}

const METRICS: MetricSpec[] = [
  {
    metricId: 'dynasty_value',
    label: 'Dynasty value',
    higherIsBetter: true,
    weight: 0.2,
    extract: ({ playerA, playerB }) => ({
      playerAValue: toFiniteNumber(playerA.projection?.value),
      playerBValue: toFiniteNumber(playerB.projection?.value),
    }),
  },
  {
    metricId: 'overall_rank',
    label: 'Overall rank',
    higherIsBetter: false,
    weight: 0.14,
    extract: ({ playerA, playerB }) => ({
      playerAValue: toFiniteNumber(playerA.projection?.rank),
      playerBValue: toFiniteNumber(playerB.projection?.rank),
    }),
  },
  {
    metricId: 'trend_30_day',
    label: '30-day trend',
    higherIsBetter: true,
    weight: 0.09,
    extract: ({ playerA, playerB }) => ({
      playerAValue: toFiniteNumber(playerA.projection?.trend30Day),
      playerBValue: toFiniteNumber(playerB.projection?.trend30Day),
    }),
  },
  {
    metricId: 'last_season_fp_per_game',
    label: 'Last season FP/Game',
    higherIsBetter: true,
    weight: 0.18,
    extract: ({ playerA, playerB }) => ({
      playerAValue: playerA.historical?.[0] ? toFpPerGame(playerA.historical[0]) : null,
      playerBValue: playerB.historical?.[0] ? toFpPerGame(playerB.historical[0]) : null,
    }),
  },
  {
    metricId: 'projection_points',
    label: 'Projection points',
    higherIsBetter: true,
    weight: 0.15,
    extract: ({ playerA, playerB }) => ({
      playerAValue: toFiniteNumber(playerA.internalProjectionPoints),
      playerBValue: toFiniteNumber(playerB.internalProjectionPoints),
    }),
  },
  {
    metricId: 'internal_adp',
    label: 'Internal ADP',
    higherIsBetter: false,
    weight: 0.05,
    extract: ({ playerA, playerB }) => ({
      playerAValue: toFiniteNumber(playerA.internalAdp),
      playerBValue: toFiniteNumber(playerB.internalAdp),
    }),
  },
  {
    metricId: 'injury_risk',
    label: 'Injury risk',
    higherIsBetter: false,
    weight: 0.08,
    extract: ({ playerA, playerB }) => ({
      playerAValue: toFiniteNumber(playerA.injury?.riskScore),
      playerBValue: toFiniteNumber(playerB.injury?.riskScore),
    }),
  },
  {
    metricId: 'schedule_difficulty',
    label: 'Schedule difficulty',
    higherIsBetter: false,
    weight: 0.06,
    extract: ({ playerA, playerB }) => ({
      playerAValue: toFiniteNumber(playerA.scheduleDifficultyScore),
      playerBValue: toFiniteNumber(playerB.scheduleDifficultyScore),
    }),
  },
  {
    metricId: 'volatility',
    label: 'Volatility',
    higherIsBetter: false,
    weight: 0.05,
    extract: ({ playerA, playerB }) => ({
      playerAValue: toFiniteNumber(playerA.projection?.volatility),
      playerBValue: toFiniteNumber(playerB.projection?.volatility),
    }),
  },
];

function buildDeterministicSummary(args: {
  rows: DeterministicStatComparisonRow[];
  playerAName: string;
  playerBName: string;
}): {
  recommendedSide: 'playerA' | 'playerB' | 'tie';
  recommendedPlayerName: string | null;
  confidencePct: number;
  summary: string;
} {
  let weightedScore = 0;
  let weightedCoverage = 0;
  const totalWeight = METRICS.reduce((sum, metric) => sum + metric.weight, 0);

  args.rows.forEach((row, index) => {
    const weight = METRICS[index]?.weight ?? 0;
    if (row.edgeScore == null) return;
    weightedScore += row.edgeScore * weight;
    weightedCoverage += weight;
  });

  let recommendedSide: 'playerA' | 'playerB' | 'tie' = 'tie';
  if (weightedScore > 0.03) recommendedSide = 'playerA';
  else if (weightedScore < -0.03) recommendedSide = 'playerB';

  const recommendedPlayerName =
    recommendedSide === 'playerA'
      ? args.playerAName
      : recommendedSide === 'playerB'
        ? args.playerBName
        : null;

  const coverageRatio = totalWeight > 0 ? weightedCoverage / totalWeight : 0;
  const baseConfidence = 50 + Math.abs(weightedScore) * 35 + coverageRatio * 15;
  const confidencePct = Math.round(clamp(recommendedSide === 'tie' ? baseConfidence - 8 : baseConfidence, 45, 95));

  const decisiveRows = args.rows
    .filter((row) => row.edgeScore != null && row.winner !== 'tie' && row.winner !== 'none')
    .sort((a, b) => Math.abs(b.edgeScore ?? 0) - Math.abs(a.edgeScore ?? 0))
    .slice(0, 3)
    .map((row) => row.label);

  const decisiveText = decisiveRows.length > 0 ? ` Key edges: ${decisiveRows.join(', ')}.` : '';
  const summary =
    recommendedSide === 'tie'
      ? `Deterministic stats comparison is close between ${args.playerAName} and ${args.playerBName}.${decisiveText}`
      : `Deterministic stats comparison favors ${recommendedPlayerName}.${decisiveText}`;

  return { recommendedSide, recommendedPlayerName, confidencePct, summary };
}

function buildDeterministicExplanation(args: {
  summary: string;
  comparisonSummaryLines: string[];
}): string {
  const support = args.comparisonSummaryLines.slice(0, 2).join(' ');
  return support ? `${args.summary} ${support}`.trim() : args.summary;
}

async function buildAIExplanation(args: {
  sport: string;
  playerAName: string;
  playerBName: string;
  deterministicSummary: string;
  rows: DeterministicStatComparisonRow[];
  deterministicExplanation: string;
}): Promise<string | null> {
  const facts = args.rows
    .filter((row) => row.winner !== 'none')
    .slice(0, 8)
    .map((row) => {
      const winnerLabel =
        row.winner === 'playerA' ? args.playerAName : row.winner === 'playerB' ? args.playerBName : 'tie';
      const aValue = row.playerAValue != null ? row.playerAValue.toFixed(2) : 'n/a';
      const bValue = row.playerBValue != null ? row.playerBValue.toFixed(2) : 'n/a';
      return `${row.label}: ${args.playerAName}=${aValue}, ${args.playerBName}=${bValue}, winner=${winnerLabel}`;
    })
    .join('\n');

  const explanation = await explainDeterministicOutput({
    feature: 'player_comparison',
    sport: args.sport,
    deterministicSummary: args.deterministicExplanation,
    deterministicEvidence: [
      `Players: ${args.playerAName} vs ${args.playerBName}`,
      `Deterministic summary: ${args.deterministicSummary}`,
      `Deterministic facts: ${facts || 'n/a'}`,
    ],
    instruction: 'Return 2 concise sentences: recommendation + caveat.',
    temperature: 0.3,
    maxTokens: 180,
    maxChars: 520,
    deterministicFallbackText: null,
  });

  if (explanation.source !== 'ai' || !explanation.text) return null;
  return explanation.text;
}

/**
 * PROMPT 241 — deterministic player comparison engine with optional AI explanation.
 */
export async function runTwoPlayerComparisonEngine(
  input: TwoPlayerComparisonEngineInput
): Promise<TwoPlayerComparisonEngineResult | null> {
  const sport = normalizeToSupportedSport(input.sport);
  const players = await comparePlayers(input.playerAName, input.playerBName, {
    sport,
    scoringFormat: input.scoringFormat,
    leagueScoringSettings: input.leagueScoringSettings ?? null,
  });
  if (!players) return null;
  const weekly = input.leagueWeekProjections;
  const comparison = weekly ? {
    ...players,
    playerA: { ...players.playerA, internalProjectionPoints: weekly.playerA, leagueWeeklyProjection: weekly.playerA },
    playerB: { ...players.playerB, internalProjectionPoints: weekly.playerB, leagueWeeklyProjection: weekly.playerB },
  } : players;

  const rows: DeterministicStatComparisonRow[] = METRICS.map((metric) => {
    const { playerAValue, playerBValue } = metric.extract({
      playerA: comparison.playerA,
      playerB: comparison.playerB,
    });
    const { winner, edgeScore } = resolveRowOutcome({
      playerAValue,
      playerBValue,
      higherIsBetter: metric.higherIsBetter,
    });
    return {
      metricId: metric.metricId,
      label: weekly && metric.metricId === 'projection_points'
        ? (weekly.week == null ? 'Weekly projected points' : 'Week ' + weekly.week + ' projected points')
        : metric.label,
      playerAValue,
      playerBValue,
      higherIsBetter: metric.higherIsBetter,
      winner,
      edgeScore: edgeScore != null ? Math.round(edgeScore * 1000) / 1000 : null,
    };
  });

  const deterministicSummary = buildDeterministicSummary({
    rows,
    playerAName: comparison.playerA.name,
    playerBName: comparison.playerB.name,
  });
  const deterministicExplanation = buildDeterministicExplanation({
    summary: deterministicSummary.summary,
    comparisonSummaryLines: comparison.summaryLines,
  });

  const output: TwoPlayerComparisonEngineResult = {
    sport,
    comparison,
    deterministic: {
      recommendedSide: deterministicSummary.recommendedSide,
      recommendedPlayerName: deterministicSummary.recommendedPlayerName,
      confidencePct: deterministicSummary.confidencePct,
      basedOn: ['stats_comparison'],
      summary: deterministicSummary.summary,
      statComparisons: rows,
    },
    explanation: {
      source: 'deterministic',
      text: deterministicExplanation,
    },
  };

  if (!input.includeAIExplanation) return output;

  const aiExplanation = await buildAIExplanation({
    sport,
    playerAName: comparison.playerA.name,
    playerBName: comparison.playerB.name,
    deterministicSummary: deterministicSummary.summary,
    rows,
    deterministicExplanation,
  });
  if (aiExplanation) {
    output.explanation = {
      source: 'ai',
      text: aiExplanation,
    };
  }

  return output;
}
