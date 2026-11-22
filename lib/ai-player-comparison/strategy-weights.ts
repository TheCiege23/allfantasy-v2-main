import type { DeterministicStatComparisonRow } from '@/lib/player-comparison-lab/types'
import type { AiPlayerComparisonStrategyMode } from './types'

/** Must match `METRICS` order in `lib/player-comparison-lab/PlayerComparisonEngine.ts`. */
const ENGINE_METRIC_IDS = [
  'dynasty_value',
  'overall_rank',
  'trend_30_day',
  'last_season_fp_per_game',
  'projection_points',
  'internal_adp',
  'injury_risk',
  'schedule_difficulty',
  'volatility',
] as const

const BASE_WEIGHT: Record<(typeof ENGINE_METRIC_IDS)[number], number> = {
  dynasty_value: 0.2,
  overall_rank: 0.14,
  trend_30_day: 0.09,
  last_season_fp_per_game: 0.18,
  projection_points: 0.15,
  internal_adp: 0.05,
  injury_risk: 0.08,
  schedule_difficulty: 0.06,
  volatility: 0.05,
}

/** Per-metric multipliers applied on top of base engine weights for scenario modes. */
const MODE_MULT: Record<
  AiPlayerComparisonStrategyMode,
  Partial<Record<(typeof ENGINE_METRIC_IDS)[number], number>>
> = {
  balanced: {},
  need_upside: {
    trend_30_day: 1.35,
    projection_points: 1.2,
    volatility: 1.25,
    injury_risk: 0.85,
    last_season_fp_per_game: 0.92,
  },
  need_floor: {
    last_season_fp_per_game: 1.35,
    projection_points: 1.08,
    volatility: 0.65,
    injury_risk: 1.2,
    trend_30_day: 0.88,
  },
  need_safety: {
    last_season_fp_per_game: 1.32,
    volatility: 0.62,
    injury_risk: 1.25,
    schedule_difficulty: 1.08,
    trend_30_day: 0.9,
  },
  underdog: {
    trend_30_day: 1.4,
    volatility: 1.28,
    schedule_difficulty: 1.15,
    projection_points: 1.08,
    overall_rank: 0.92,
  },
  favored: {
    projection_points: 1.28,
    overall_rank: 1.22,
    internal_adp: 1.15,
    last_season_fp_per_game: 1.12,
    volatility: 0.85,
  },
}

function clamp01(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

export function normalizeStrategyMode(
  raw: string | null | undefined
): AiPlayerComparisonStrategyMode {
  const s = String(raw ?? 'balanced')
    .toLowerCase()
    .trim()
  if (
    s === 'need_upside' ||
    s === 'upside' ||
    s === 'ceiling' ||
    s === 'boom'
  )
    return 'need_upside'
  if (s === 'need_floor' || s === 'floor' || s === 'safe_floor') return 'need_floor'
  if (s === 'need_safety' || s === 'safety') return 'need_safety'
  if (s === 'underdog' || s === 'dog') return 'underdog'
  if (s === 'favored' || s === 'favorite' || s === 'chalk') return 'favored'
  if (s === 'balanced' || s === 'neutral') return 'balanced'
  return 'balanced'
}

/**
 * Re-score using the same edge rows as the lab engine, with scenario-adjusted weights.
 * Does not override facts — only changes how much each edge matters.
 */
export function scoreRowsForStrategyMode(
  rows: DeterministicStatComparisonRow[],
  mode: AiPlayerComparisonStrategyMode
): { score: number; coverageWeight: number; totalWeight: number } {
  const mult = MODE_MULT[mode] ?? {}
  let score = 0
  let totalWeight = 0
  let coverageWeight = 0

  for (const row of rows) {
    const id = row.metricId as (typeof ENGINE_METRIC_IDS)[number]
    const w0 = BASE_WEIGHT[id]
    if (w0 == null || row.edgeScore == null) continue
    const m = mult[id] ?? 1
    const w = w0 * m
    totalWeight += w
    coverageWeight += w
    score += row.edgeScore * w
  }

  if (totalWeight <= 0) return { score: 0, coverageWeight: 0, totalWeight: 0 }
  return { score, coverageWeight, totalWeight }
}

export function resolveRecommendedSideFromScore(score: number): 'playerA' | 'playerB' | 'tie' {
  if (score > 0.025) return 'playerA'
  if (score < -0.025) return 'playerB'
  return 'tie'
}

export function confidenceFromScore(
  score: number,
  recommendedSide: 'playerA' | 'playerB' | 'tie',
  coverageRatio: number
): number {
  const abs = Math.abs(score)
  const base = 50 + abs * 38 + coverageRatio * 12
  return Math.round(
    clamp01(recommendedSide === 'tie' ? base - 10 : base, 42, 94)
  )
}
