/**
 * Warehouse snapshot integration for Season Forecast.
 *
 * Persists forecast summary so downstream systems (standings page, playoff race cards,
 * AI summaries, commissioner insights) can read from a single source.
 * Primary storage is SeasonForecastSnapshot; when a data warehouse SimulationSnapshot
 * (or equivalent) table exists, this module can also write there for analytics.
 */

import { prisma } from '@/lib/prisma'
import type { TeamSeasonForecast } from './types'

interface ForecastSnapshotForWarehouse {
  leagueId: string
  season: number
  week: number
  teamForecasts: TeamSeasonForecast[]
  generatedAt: string
}

/**
 * Persist forecast to SeasonForecastSnapshot (already done in SeasonForecastEngine).
 * This helper can be used by jobs that want to write warehouse-style records.
 */
export async function persistForecastSnapshot(payload: ForecastSnapshotForWarehouse): Promise<string> {
  const league = await prisma.league.findFirst({
    where: { OR: [{ id: payload.leagueId }, { platformLeagueId: payload.leagueId }] },
    select: { sport: true },
  })
  const sportType = league?.sport ?? null

  const snapshot = await prisma.seasonForecastSnapshot.upsert({
    where: {
      uniq_season_forecast_league_season_week: {
        leagueId: payload.leagueId,
        season: payload.season,
        week: payload.week,
      },
    },
    create: {
      leagueId: payload.leagueId,
      sportType,
      season: payload.season,
      week: payload.week,
      teamForecasts: payload.teamForecasts as unknown as object,
    },
    update: {
      sportType,
      teamForecasts: payload.teamForecasts as unknown as object,
    },
  })
  return snapshot.id
}

/**
 * If your schema includes a generic SimulationSnapshot (e.g. dw_simulation_snapshots),
 * uncomment and use this to also write there for warehouse queries.
 */
// export async function writeToWarehouseSimulation(
//   snapshotId: string,
//   payload: ForecastSnapshotForWarehouse
// ): Promise<void> {
//   await (prisma as any).simulationSnapshot?.create({
//     data: {
//       simulationId: snapshotId,
//       leagueId: payload.leagueId,
//       season: payload.season,
//       week: payload.week,
//       simulationType: 'season_forecast',
//       resultData: payload.teamForecasts,
//     },
//   })
// }
