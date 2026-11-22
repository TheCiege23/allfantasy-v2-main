/**
 * Trajectory Foundation — Season Forecast adapter (Deliverable 3, flagship
 * SUPPORTED source).
 *
 * `SeasonForecastSnapshot` stores exactly one real row per `(leagueId, season,
 * week), so week-over-week
 * movement in playoff odds, championship odds, expected wins, seed, etc. is
 * GENUINE captured history — not a computed guess. Each team forecast also ships
 * the engine's own `confidenceScore`, which we pass through as the point's
 * confidence (never invented).
 *
 * The normalization is a pure function (`mapSeasonForecastPoints`) so it is
 * testable without a DB; the DB read is isolated behind injectable deps.
 */
import { prisma as defaultPrisma } from '@/lib/prisma'
import type { TeamSeasonForecast } from '@/lib/season-forecast/types'
import type { TrajectoryAdapter, TrajectoryPoint } from '../types'

/** Numeric per-team fields on `TeamSeasonForecast` that form a real weekly series. */
export type SeasonForecastMetricField =
  | 'playoffProbability'
  | 'championshipProbability'
  | 'firstPlaceProbability'
  | 'expectedWins'
  | 'expectedFinalSeed'
  | 'eliminationRisk'

const SEASON_FORECAST_METRIC_IDS: Record<SeasonForecastMetricField, string> = {
  playoffProbability: 'season.playoffProbability',
  championshipProbability: 'season.championshipProbability',
  firstPlaceProbability: 'season.firstPlaceProbability',
  expectedWins: 'season.expectedWins',
  expectedFinalSeed: 'season.expectedFinalSeed',
  eliminationRisk: 'season.eliminationRisk',
}

export interface SeasonForecastTrajectoryParams {
  leagueId: string
  season: number
  /** The team whose per-week trajectory is wanted (rosterId / teamId). */
  teamId: string
}

/** A raw snapshot row reduced to exactly what the trajectory needs. */
export interface SeasonForecastHistoryRow {
  week: number
  /** ISO-8601. */
  generatedAt: string
  teamForecasts: TeamSeasonForecast[]
}

/**
 * Pure. Maps real snapshot rows → points for one team + field. Rows that do not
 * contain the team, or whose value is missing/NaN, are SKIPPED — never filled in
 * with a fabricated value. Uses the engine's own `confidenceScore` as the point
 * confidence.
 */
export function mapSeasonForecastPoints(
  rows: SeasonForecastHistoryRow[],
  teamId: string,
  field: SeasonForecastMetricField,
): TrajectoryPoint[] {
  const points: TrajectoryPoint[] = []
  for (const row of rows) {
    const team = row.teamForecasts.find((t) => t.teamId === teamId)
    if (!team) continue
    const value = team[field]
    if (typeof value !== 'number' || Number.isNaN(value)) continue
    points.push({
      value,
      timestamp: row.generatedAt,
      confidence: typeof team.confidenceScore === 'number' ? team.confidenceScore : undefined,
      label: `Week ${row.week}`,
    })
  }
  return points
}

export interface SeasonForecastAdapterDeps {
  loadRows(params: SeasonForecastTrajectoryParams): Promise<SeasonForecastHistoryRow[]>
}

const defaultDeps: SeasonForecastAdapterDeps = {
  async loadRows({ leagueId, season }) {
    const rows = await defaultPrisma.seasonForecastSnapshot.findMany({
      where: { leagueId, season },
      orderBy: { week: 'asc' },
      select: { week: true, generatedAt: true, teamForecasts: true },
    })
    return rows.map((r: { week: number; generatedAt: Date; teamForecasts: unknown }) => ({
      week: r.week,
      generatedAt: r.generatedAt.toISOString(),
      teamForecasts: (r.teamForecasts as unknown as TeamSeasonForecast[]) ?? [],
    }))
  },
}

/**
 * Creates a SUPPORTED adapter for one Season Forecast metric field. Backed by a
 * real per-week store, so `supported: true`. The engine records no per-week
 * textual reason, so `explainChange` is an honest `null` (no fake explanation).
 */
export function createSeasonForecastAdapter(
  field: SeasonForecastMetricField,
  deps: SeasonForecastAdapterDeps = defaultDeps,
): TrajectoryAdapter<SeasonForecastTrajectoryParams> {
  return {
    metricId: SEASON_FORECAST_METRIC_IDS[field],
    supported: true,
    async load(params) {
      const rows = await deps.loadRows(params)
      return mapSeasonForecastPoints(rows, params.teamId, field)
    },
    explainChange: () => null,
  }
}
