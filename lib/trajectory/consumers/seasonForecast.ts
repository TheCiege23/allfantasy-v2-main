/**
 * Trajectory Foundation — Season Forecast consumer composition.
 *
 * The first real consumer glue (Dashboard V2 Phase 3.4). Composes the generic
 * service + the Season Forecast adapter + the compact summary into a per-team,
 * per-field trajectory the Season Outlook card can render directly.
 *
 * Lives in `consumers/` (not `adapters/`) so the adapter stays pure — this layer
 * is allowed to depend on the service. It does NO IO of its own: the caller (the
 * API route) performs a single snapshot read and passes the rows in, so building
 * every team's trajectory costs one query, not one-per-team.
 */
import { getTrajectory } from '../service'
import { summarizeTrajectory, type TrajectorySummary } from '../summarize'
import {
  createSeasonForecastAdapter,
  type SeasonForecastAdapterDeps,
  type SeasonForecastHistoryRow,
  type SeasonForecastMetricField,
  type SeasonForecastTrajectoryParams,
} from '../adapters/seasonForecast'

/** The four fields the Season Outlook card surfaces trajectories for. */
const SEASON_FORECAST_CARD_FIELDS = [
  'playoffProbability',
  'championshipProbability',
  'expectedWins',
  'expectedFinalSeed',
] as const satisfies readonly SeasonForecastMetricField[]

/** Per-field trajectory summaries for one team. */
export type TeamForecastTrajectory = Partial<Record<SeasonForecastMetricField, TrajectorySummary>>

/**
 * Builds the per-field trajectory summary map for one team from already-loaded
 * snapshot rows (oldest → newest is handled by the service). Uses the real
 * `getTrajectory` path so `supported` / delta / `whyChanged` are exactly what the
 * foundation produces — nothing is re-derived or faked here.
 */
export async function buildTeamForecastTrajectory(
  params: SeasonForecastTrajectoryParams,
  rows: SeasonForecastHistoryRow[],
  fields: readonly SeasonForecastMetricField[] = SEASON_FORECAST_CARD_FIELDS,
): Promise<TeamForecastTrajectory> {
  // Inject the pre-loaded rows so every field/team reuses one snapshot read.
  const deps: SeasonForecastAdapterDeps = { loadRows: async () => rows }
  const out: TeamForecastTrajectory = {}
  for (const field of fields) {
    const trajectory = await getTrajectory(createSeasonForecastAdapter(field, deps), params)
    out[field] = summarizeTrajectory(trajectory)
  }
  return out
}
