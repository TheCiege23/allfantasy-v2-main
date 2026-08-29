import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerComparisonResult, ResolvedPlayerStats } from '@/lib/player-comparison-lab/types';

const comparePlayersMock = vi.fn();
const openaiChatTextMock = vi.fn();

vi.mock('@/lib/player-comparison-lab/PlayerComparisonService', () => ({
  comparePlayers: comparePlayersMock,
}));

vi.mock('@/lib/openai-client', () => ({
  openaiChatText: openaiChatTextMock,
}));

function buildResolvedPlayer(input: {
  name: string;
  value: number;
  rank: number;
  trend30Day: number;
  fpPerGame: number;
  projectionPoints: number;
  internalAdp: number;
  injuryRisk: number;
  scheduleDifficulty: number;
  volatility: number;
}): ResolvedPlayerStats {
  return {
    name: input.name,
    position: 'WR',
    team: 'TEST',
    historical: [
      {
        season: '2025',
        gamesPlayed: 17,
        fantasyPoints: input.fpPerGame * 17,
        fantasyPointsPerGame: input.fpPerGame,
      },
    ],
    projection: {
      value: input.value,
      rank: input.rank,
      positionRank: input.rank,
      trend30Day: input.trend30Day,
      redraftValue: input.projectionPoints,
      source: 'test',
      position: 'WR',
      team: 'TEST',
      volatility: input.volatility,
    },
    internalAdp: input.internalAdp,
    sleeperAdp: input.internalAdp + 1,
    internalProjectionPoints: input.projectionPoints,
    injury: {
      status: 'active',
      source: 'espn',
      riskScore: input.injuryRisk,
      note: null,
    },
    scheduleDifficultyScore: input.scheduleDifficulty,
    sourceFlags: {
      fantasyCalc: true,
      sleeper: true,
      espnInjuryFeed: true,
      internalAdp: true,
      /*
       * ⚠ tsconfig EXCLUDES `__tests__`, so a fixture that drifts from
       * DeterministicSourceFlags is never caught by tsc — it just quietly stops describing
       * the shape under test. Keep this list in step with the interface by hand.
       */
      marketAdp: false,
      internalProjections: true,
      leagueScoringSettings: false,
    },
  };
}

function buildComparisonResult(playerA: ResolvedPlayerStats, playerB: ResolvedPlayerStats): PlayerComparisonResult {
  return {
    playerA,
    playerB,
    chartSeries: [],
    summaryLines: ['Deterministic stat summary line 1.', 'Deterministic stat summary line 2.'],
  };
}

describe('PlayerComparisonEngine', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { clearAICostControlStateForTests } = await import('@/lib/ai-cost-control');
    clearAICostControlStateForTests();
  });

  it('returns deterministic recommendation from stats comparison', async () => {
    comparePlayersMock.mockResolvedValueOnce(
      buildComparisonResult(
        buildResolvedPlayer({
          name: 'Player A',
          value: 9200,
          rank: 8,
          trend30Day: 120,
          fpPerGame: 21.4,
          projectionPoints: 335,
          internalAdp: 18,
          injuryRisk: 22,
          scheduleDifficulty: 40,
          volatility: 10,
        }),
        buildResolvedPlayer({
          name: 'Player B',
          value: 8400,
          rank: 22,
          trend30Day: 75,
          fpPerGame: 17.8,
          projectionPoints: 291,
          internalAdp: 31,
          injuryRisk: 48,
          scheduleDifficulty: 61,
          volatility: 17,
        })
      )
    );

    const { runTwoPlayerComparisonEngine } = await import('@/lib/player-comparison-lab/PlayerComparisonEngine');
    const result = await runTwoPlayerComparisonEngine({
      playerAName: 'Player A',
      playerBName: 'Player B',
      sport: 'NFL',
      includeAIExplanation: false,
    });

    expect(result).not.toBeNull();
    expect(result?.deterministic.recommendedSide).toBe('playerA');
    expect(result?.deterministic.recommendedPlayerName).toBe('Player A');
    expect(result?.explanation.source).toBe('deterministic');
    expect(result?.deterministic.statComparisons.length).toBeGreaterThan(0);
  });

  it('uses AI explanation when requested and available', async () => {
    comparePlayersMock.mockResolvedValueOnce(
      buildComparisonResult(
        buildResolvedPlayer({
          name: 'Player A',
          value: 9000,
          rank: 10,
          trend30Day: 100,
          fpPerGame: 20,
          projectionPoints: 320,
          internalAdp: 20,
          injuryRisk: 20,
          scheduleDifficulty: 45,
          volatility: 11,
        }),
        buildResolvedPlayer({
          name: 'Player B',
          value: 8700,
          rank: 16,
          trend30Day: 80,
          fpPerGame: 18.8,
          projectionPoints: 305,
          internalAdp: 27,
          injuryRisk: 30,
          scheduleDifficulty: 58,
          volatility: 14,
        })
      )
    );
    openaiChatTextMock.mockResolvedValueOnce({
      ok: true,
      text: 'Player A holds the stronger deterministic edge this week. If your roster build prioritizes floor, keep Player A ahead with Player B as the fallback.',
      model: 'test',
      baseUrl: 'http://test',
    });

    const { runTwoPlayerComparisonEngine } = await import('@/lib/player-comparison-lab/PlayerComparisonEngine');
    const result = await runTwoPlayerComparisonEngine({
      playerAName: 'Player A',
      playerBName: 'Player B',
      includeAIExplanation: true,
    });

    expect(result?.explanation.source).toBe('ai');
    expect(result?.explanation.text).toMatch(/fallback/i);
  });

  it('falls back to deterministic explanation when AI fails', async () => {
    comparePlayersMock.mockResolvedValueOnce(
      buildComparisonResult(
        buildResolvedPlayer({
          name: 'Player A',
          value: 8900,
          rank: 11,
          trend30Day: 95,
          fpPerGame: 19.5,
          projectionPoints: 315,
          internalAdp: 21,
          injuryRisk: 28,
          scheduleDifficulty: 52,
          volatility: 12,
        }),
        buildResolvedPlayer({
          name: 'Player B',
          value: 8600,
          rank: 17,
          trend30Day: 80,
          fpPerGame: 18.5,
          projectionPoints: 301,
          internalAdp: 29,
          injuryRisk: 36,
          scheduleDifficulty: 58,
          volatility: 15,
        })
      )
    );
    openaiChatTextMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      details: 'provider unavailable',
      model: 'test',
      baseUrl: '',
    });

    const { runTwoPlayerComparisonEngine } = await import('@/lib/player-comparison-lab/PlayerComparisonEngine');
    const result = await runTwoPlayerComparisonEngine({
      playerAName: 'Player A',
      playerBName: 'Player B',
      includeAIExplanation: true,
    });

    expect(result?.explanation.source).toBe('deterministic');
    expect(result?.explanation.text).toContain('Deterministic stats comparison');
  });
});
