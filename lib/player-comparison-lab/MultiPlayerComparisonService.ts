/**
 * Multi-player comparison (2–6 players): matrix, category winners, VORP, consistency, volatility (Prompt 130).
 */

import { resolvePlayerStats } from './PlayerStatsResolver';
import type {
  ResolvedPlayerStats,
  MultiPlayerComparisonResult,
  ComparisonMatrixRow,
  CategoryWinnerHighlight,
  PlayerComparisonScores,
  ComparisonDimensionId,
  ScoringFormat,
  LeagueScoringSettings,
  DeterministicSourceFlags,
} from './types';
import { DEFAULT_SPORT, normalizeToSupportedSport } from '@/lib/sport-scope';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

export interface ComparePlayersMultiOptions {
  sport?: string | null;
  scoringFormat?: ScoringFormat;
  leagueScoringSettings?: LeagueScoringSettings | null;
}

export async function comparePlayersMulti(
  playerNames: string[],
  options?: ComparePlayersMultiOptions
): Promise<MultiPlayerComparisonResult | null> {
  const trimmed = playerNames.map((n) => n.trim()).filter(Boolean);
  if (trimmed.length < MIN_PLAYERS || trimmed.length > MAX_PLAYERS) return null;

  const sport = normalizeToSupportedSport(options?.sport ?? DEFAULT_SPORT);
  const scoringFormat = options?.scoringFormat ?? 'ppr';

  const resolved = await Promise.all(
    trimmed.map((name) =>
      resolvePlayerStats(name, {
        sport,
        scoringFormat,
        leagueScoringSettings: options?.leagueScoringSettings ?? null,
      })
    )
  );

  const players: ResolvedPlayerStats[] = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (resolved[i]) players.push(resolved[i]!);
  }
  if (players.length < MIN_PLAYERS) return null;

  const matrix = buildMatrix(players);
  const categoryWinners = buildCategoryWinners(matrix);
  const playerScores = buildPlayerScores(players);
  const sourceCoverage = buildSourceCoverage(players, options?.leagueScoringSettings ?? null);
  const summaryLines = buildSummaryLines(players, matrix);

  return {
    sport,
    scoringFormat,
    leagueScoringSettings: options?.leagueScoringSettings ?? null,
    players,
    matrix,
    categoryWinners,
    playerScores,
    summaryLines,
    sourceCoverage,
  };
}

function buildMatrix(players: ResolvedPlayerStats[]): ComparisonMatrixRow[] {
  const rows: ComparisonMatrixRow[] = [];

  // Market value (dynasty value)
  const marketValues: Record<string, number | null> = {};
  players.forEach((p) => {
    const adpValueProxy =
      p.internalAdp != null
        ? Math.max(0, 10000 - p.internalAdp * 35)
        : p.sleeperAdp != null
          ? Math.max(0, 10000 - p.sleeperAdp * 35)
          : null;
    marketValues[p.name] = p.projection?.value ?? adpValueProxy;
  });
  rows.push(buildRow('market_value', 'Market value', marketValues, true));

  // Fantasy production (last season FP/game or avg)
  const production: Record<string, number | null> = {};
  players.forEach((p) => {
    const last = p.historical[0];
    const fp = last?.fantasyPointsPerGame ?? (last?.fantasyPoints && last?.gamesPlayed ? last.fantasyPoints / last.gamesPlayed : null);
    production[p.name] = fp != null ? Math.round(fp * 10) / 10 : null;
  });
  rows.push(buildRow('fantasy_production', 'Fantasy production', production, true));

  // Projection (same as value for now, or redraft)
  const projection: Record<string, number | null> = {};
  players.forEach((p) => {
    projection[p.name] =
      p.internalProjectionPoints ??
      p.projection?.redraftValue ??
      p.projection?.value ??
      null;
  });
  rows.push(buildRow('projection', 'Projection', projection, true));

  // Volatility (lower = better)
  const volatility: Record<string, number | null> = {};
  players.forEach((p) => {
    volatility[p.name] = p.projection?.volatility ?? computeVolatilityScore(p);
  });
  rows.push(buildRow('volatility', 'Volatility', volatility, false));

  // Consistency (higher = better; from historical variance inverse)
  const consistency: Record<string, number | null> = {};
  players.forEach((p) => {
    consistency[p.name] = computeConsistencyScore(p);
  });
  rows.push(buildRow('consistency', 'Consistency', consistency, true));

  // Schedule difficulty (higher = harder)
  const schedule: Record<string, number | null> = {};
  players.forEach((p) => {
    schedule[p.name] = p.scheduleDifficultyScore;
  });
  rows.push(buildRow('schedule_difficulty', 'Schedule difficulty', schedule, false));

  // Injury risk (higher = riskier)
  const injury: Record<string, number | null> = {};
  players.forEach((p) => {
    injury[p.name] = p.injury.riskScore;
  });
  rows.push(buildRow('injury_risk', 'Injury risk', injury, false));

  // Trend momentum (30-day trend)
  const trend: Record<string, number | null> = {};
  players.forEach((p) => {
    trend[p.name] = p.projection?.trend30Day ?? null;
  });
  rows.push(buildRow('trend_momentum', 'Trend momentum', trend, true));

  return rows;
}

function buildRow(
  dimensionId: ComparisonDimensionId,
  label: string,
  valuesByPlayer: Record<string, number | null>,
  higherIsBetter: boolean
): ComparisonMatrixRow {
  const entries = Object.entries(valuesByPlayer).filter(
    ([, v]) => v != null && Number.isFinite(v)
  ) as [string, number][];
  let winnerName: string | null = null;
  if (entries.length > 0) {
    const sorted = [...entries].sort((a, b) => (higherIsBetter ? b[1] - a[1] : a[1] - b[1]));
    const top = sorted[0];
    const runnerUp = sorted[1];
    winnerName = runnerUp && top[1] === runnerUp[1] ? null : top[0];
  }
  return {
    dimensionId,
    label,
    valuesByPlayer,
    winnerName,
    higherIsBetter,
  };
}

function computeConsistencyScore(p: ResolvedPlayerStats): number | null {
  const fps = p.historical
    .map((h) => h.fantasyPointsPerGame ?? (h.gamesPlayed && h.fantasyPoints ? h.fantasyPoints / h.gamesPlayed : null))
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (fps.length < 2) return null;
  const mean = fps.reduce((s, v) => s + v, 0) / fps.length;
  const variance = fps.reduce((s, v) => s + (v - mean) ** 2, 0) / fps.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 100;
  // Lower std = higher consistency; scale to 0–100 (inverse of coefficient of variation)
  const cv = mean !== 0 ? std / Math.abs(mean) : 1;
  return Math.round(Math.min(100, Math.max(0, 100 - cv * 100)));
}

function computeVolatilityScore(p: ResolvedPlayerStats): number | null {
  const fps = p.historical
    .map((h) =>
      h.fantasyPointsPerGame ??
      (h.gamesPlayed && h.fantasyPoints ? h.fantasyPoints / h.gamesPlayed : null)
    )
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (fps.length < 2) return null;
  const mean = fps.reduce((sum, value) => sum + value, 0) / fps.length;
  if (mean === 0) return null;
  const variance = fps.reduce((sum, value) => sum + (value - mean) ** 2, 0) / fps.length;
  const std = Math.sqrt(variance);
  return Math.round((std / Math.abs(mean)) * 1000) / 10;
}

function buildCategoryWinners(matrix: ComparisonMatrixRow[]): CategoryWinnerHighlight[] {
  return matrix
    .filter((r) => r.winnerName != null)
    .map((r) => ({
      dimensionId: r.dimensionId,
      label: r.label,
      winnerName: r.winnerName!,
      value: r.valuesByPlayer[r.winnerName!] ?? null,
    }));
}

function buildPlayerScores(players: ResolvedPlayerStats[]): PlayerComparisonScores[] {
  const projected = players.map(
    (p) => p.internalProjectionPoints ?? p.projection?.redraftValue ?? p.projection?.value ?? null
  );
  const validProjected = projected.filter((v): v is number => v != null && Number.isFinite(v));
  const replacementBaseline =
    validProjected.length > 0 ? Math.min(...validProjected) : null;
  const averageProjection =
    validProjected.length > 0
      ? validProjected.reduce((sum, value) => sum + value, 0) / validProjected.length
      : null;

  return players.map((p) => {
    const projectionPoints =
      p.internalProjectionPoints ?? p.projection?.redraftValue ?? p.projection?.value ?? null;
    const vorpDifference =
      projectionPoints != null && replacementBaseline != null
        ? projectionPoints - replacementBaseline
        : null;
    const projectionDelta =
      projectionPoints != null && averageProjection != null
        ? projectionPoints - averageProjection
        : null;
    const consistencyScore = computeConsistencyScore(p);
    const volatilityScore = p.projection?.volatility ?? computeVolatilityScore(p);
    return {
      playerName: p.name,
      vorpDifference,
      projectionDelta,
      consistencyScore,
      volatilityScore,
    };
  });
}

function buildSourceCoverage(
  players: ResolvedPlayerStats[],
  leagueScoringSettings: LeagueScoringSettings | null
): DeterministicSourceFlags {
  return {
    fantasyCalc: players.some((p) => p.sourceFlags.fantasyCalc),
    sleeper: players.some((p) => p.sourceFlags.sleeper),
    espnInjuryFeed: players.some((p) => p.sourceFlags.espnInjuryFeed),
    internalAdp: players.some((p) => p.sourceFlags.internalAdp),
    internalProjections: players.some((p) => p.sourceFlags.internalProjections),
    // Player-derived like the five above, so it aggregates the same way. It was
    // added to DeterministicSourceFlags as REQUIRED in 484053ecd and this
    // construction site was never updated, which is why deployed main carries a
    // TS2741 here. `PlayerStatsResolver` already sets the per-player flag
    // (`marketAdp != null`); nothing but the fold was missing.
    marketAdp: players.some((p) => p.sourceFlags.marketAdp),
    leagueScoringSettings:
      leagueScoringSettings != null && Object.keys(leagueScoringSettings).length > 0,
  };
}

function buildSummaryLines(players: ResolvedPlayerStats[], matrix: ComparisonMatrixRow[]): string[] {
  const lines: string[] = [];
  const winners = matrix.filter((r) => r.winnerName);
  winners.forEach((r) => {
    const v = r.valuesByPlayer[r.winnerName!];
    const valStr = v != null ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : '—';
    lines.push(`${r.label}: ${r.winnerName} (${valStr}).`);
  });
  if (lines.length === 0) {
    lines.push('Add projection or historical data to see comparison summary.');
  } else {
    const winnerCounts = new Map<string, number>();
    for (const row of winners) {
      winnerCounts.set(row.winnerName!, (winnerCounts.get(row.winnerName!) ?? 0) + 1);
    }
    const topWinner = [...winnerCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topWinner) {
      lines.unshift(`${topWinner[0]} wins ${topWinner[1]} of ${winners.length} scored categories.`);
    }
  }
  return lines;
}
